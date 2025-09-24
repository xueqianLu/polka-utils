#!/usr/bin/env node
/**
 * 将节点启动时的 --name (你在 nodes 文件里人工填写) 与链上 validator 地址自动关联。
 * 工作原理：
 * 1. 从任意参考节点获取当前 session.validators 列表及每个 validator 的 session.nextKeys，收集所有共识公钥 (babe/grandpa/imonline/authority_discovery/para_validator/para_assignment/beefy)。
 * 2. 逐个连接待匹配的节点 RPC，调用 author.hasKey(pubKey, keyType) 询问“你本地是否持有该公钥对应 keyType”。
 * 3. 一旦匹配成功，认为该节点运行对应 validator 账号。
 * 4. 生成映射 JSON。
 *
 * 重要限制：
 * - 如果节点关闭了 author.* RPC (生产环境常见)，则无法匹配，会标记 unknown。
 * - 如果一个验证者运行多个节点（冗余设置），所有具有相同 session key 的节点都会映射到同一地址。
 * - --name 并不能通过链上直接查询，脚本依赖你提供的列表文件来记录 name 与 endpoint。
 * - 如果链不使用这些共识 key (极少见自定义 runtime)，需手工调整 keyType 映射。
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import pLimit from 'p-limit';

const argv = yargs(hideBin(process.argv))
  .option('reference-endpoint', {
    alias: 'r',
    type: 'string',
    default: 'wss://rpc.polkadot.io',
    describe: '用来读取 validators 与 session.nextKeys 的参考节点'
  })
  .option('nodes-file', {
    alias: 'n',
    type: 'string',
    demandOption: true,
    describe: '包含节点名称与 WS 端点的文本文件, 格式: name,ws://endpoint 或 name ws://endpoint (每行一个)'
  })
  .option('out', {
    alias: 'o',
    type: 'string',
    default: 'node-validator-map.json',
    describe: '输出映射 JSON 文件'
  })
  .option('max-per-node-keys', {
    type: 'number',
    default: 20,
    describe: '最多尝试的公钥数量（防止极端情况下过多 RPC 调用）'
  })
  .option('concurrency', {
    alias: 'c',
    type: 'number',
    default: 8,
    describe: '并发连接待匹配节点的数量'
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: '输出调试日志'
  })
  .help()
  .alias('help','h')
  .example('$0 -n nodes.txt', '读取 nodes.txt 生成节点名称到 validator 地址的映射')
  .example('$0 -n nodes.txt -r wss://kusama-rpc.polkadot.io -o kusama-map.json', '指定参考链与输出文件')
  .argv;

// 将 session.nextKeys 的字段名映射到 author.hasKey keyType
const FIELD_KEYTYPE_MAP = {
  grandpa: 'gran',
  babe: 'babe',
  im_online: 'imon',
  imOnline: 'imon',
  authority_discovery: 'audi',
  authorityDiscovery: 'audi',
  para_validator: 'para',
  paraValidator: 'para',
  para_assignment: 'asgn',
  paraAssignment: 'asgn',
  beefy: 'beef'
};

function parseNodesFile(path){
  if(!fs.existsSync(path)) throw new Error(`nodes-file 不存在: ${path}`);
  const lines = fs.readFileSync(path,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const entries = [];
  lines.forEach((line,i)=>{
    if(line.startsWith('#')) return; // 注释
    let name, endpoint;
    if(line.includes(',')){
      [name, endpoint] = line.split(',').map(s=>s.trim());
    } else {
      [name, endpoint] = line.split(/\s+/);
    }
    if(!name || !endpoint) throw new Error(`nodes-file 第 ${i+1} 行格式错误: ${line}`);
    entries.push({ name, endpoint });
  });
  return entries;
}

async function collectValidatorKeyIndex(api){
  const validators = await api.query.session.validators();
  const mapping = []; // { validator, field, keyType, pubKey }
  for(const v of validators){
    const validatorId = v.toString();
    const keysOpt = await api.query.session.nextKeys(v);
    if(!keysOpt || !keysOpt.isSome) continue;
    const json = keysOpt.toJSON();
    if(typeof json !== 'object' || !json) continue;
    Object.entries(json).forEach(([field, hex]) => {
      if(typeof hex === 'string' && hex.startsWith('0x') && hex.length > 10){
        const keyType = FIELD_KEYTYPE_MAP[field];
        if(keyType){
          mapping.push({ validator: validatorId, field, keyType, pubKey: hex });
        }
      }
    });
  }
  return mapping;
}

async function tryMatchNode(nodeEntry, keyIndex){
  let api; // 针对该节点单独连接
  const { name, endpoint } = nodeEntry;
  try {
    api = await ApiPromise.create({ provider: new WsProvider(endpoint) });
  } catch (e){
    return { name, endpoint, error: `连接失败: ${e.message}` };
  }
  try {
    if(!api.rpc.author || !api.rpc.author.hasKey){
      return { name, endpoint, error: 'author.hasKey 不可用 (被禁用或无此方法)' };
    }
    // 去重 (同一 validator 可能多个字段) -> 按 key 列表
    const candidates = keyIndex.slice(0, argv['max-per-node-keys']);
    for(const { validator, keyType, pubKey, field } of candidates){
      try {
        const has = await api.rpc.author.hasKey(pubKey, keyType);
        if(has.isTrue){
          return { name, endpoint, validator, keyType, pubKey, field };
        }
      } catch (inner){
        if(argv.verbose) console.error(`[${name}] hasKey 调用失败 ${keyType}: ${inner.message}`);
      }
    }
    return { name, endpoint, validator: null };
  } finally {
    try { await api.disconnect(); } catch {}
  }
}

async function main(){
  console.log(`🔗 连接参考节点: ${argv['reference-endpoint']}`);
  const refApi = await ApiPromise.create({ provider: new WsProvider(argv['reference-endpoint']) });
  console.log('✅ 参考节点已连接');
  let keyIndex;
  try {
    keyIndex = await collectValidatorKeyIndex(refApi);
    if(!keyIndex.length){
      console.log('⚠️ 未获取到任何 session.nextKeys 公钥；可能该链使用不同机制或无权限。');
    } else {
      console.log(`📦 收集到 ${keyIndex.length} 条 (validator, keyType, pubKey) 记录`);
    }
  } finally {
    await refApi.disconnect();
  }

  const nodes = parseNodesFile(argv['nodes-file']);
  console.log(`🗂 待匹配节点数: ${nodes.length}`);

  const limit = pLimit(Math.max(1, argv.concurrency));
  const tasks = nodes.map(n => limit(()=>tryMatchNode(n, keyIndex)));
  const results = [];
  let done = 0;
  for(const t of tasks){
    const r = await t;
    results.push(r);
    done++;
    if(argv.verbose || done % 5 === 0){
      console.log(`⏱ 进度 ${done}/${nodes.length}`);
    }
  }

  const success = results.filter(r => r.validator);
  const failed = results.filter(r => !r.validator);

  const output = {
    generatedAt: new Date().toISOString(),
    referenceEndpoint: argv['reference-endpoint'],
    totalNodes: nodes.length,
    matched: success.length,
    unmatched: failed.length,
    nodes: results
  };

  fs.writeFileSync(argv.out, JSON.stringify(output, null, 2));
  console.log(`💾 已写入映射文件 ${argv.out}`);
  console.log(`✅ 匹配成功 ${success.length} / ${nodes.length}`);
  if(failed.length){
    console.log('⚠️ 未匹配节点（可能原因：非验证者、关闭 author RPC、不同网络、limit 截断、无 session.keys）：');
    failed.forEach(f => console.log(` - ${f.name}@${f.endpoint} ${f.error ? ' => ' + f.error : ''}`));
  }
  console.log('完成');
}

process.on('unhandledRejection', r => { console.error('Unhandled rejection', r); process.exit(1); });

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });

