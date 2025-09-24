#!/usr/bin/env node
import { ApiPromise, WsProvider } from '@polkadot/api';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';

const argv = yargs(hideBin(process.argv))
  .option('endpoint', {
    alias: 'e',
    type: 'string',
    default: 'wss://rpc.polkadot.io',
    describe: 'WebSocket RPC endpoint'
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    default: 'roles.json',
    describe: 'Output JSON file path'
  })
  .option('format', {
    alias: 'f',
    type: 'string',
    choices: ['array', 'object'],
    default: 'array',
    describe: 'JSON 输出格式: array => [ { address, display, role } ]; object => { address: role }'
  })
  .option('patterns', {
    type: 'string',
    describe: '逗号分隔的 display 子串=Role 规则 (不区分大小写)，例如: binance=Exchange,stakefish=Infra'
  })
  .option('default-role', {
    type: 'string',
    default: 'Unknown',
    describe: '未匹配时默认角色'
  })
  .option('limit', {
    type: 'number',
    describe: '仅处理前 N 个 validators，用于测试'
  })
  .option('include-display', {
    type: 'boolean',
    default: true,
    describe: '在 array 格式中是否包含 display 字段'
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Verbose 日志'
  })
  .help()
  .alias('help','h')
  .example('$0 --patterns "binance=Exchange,stakefish=Infra"', '基于 identity display 关键字生成角色映射')
  .example('$0 -e wss://kusama-rpc.polkadot.io -o kusama-roles.json', '指定网络与输出文件')
  .argv;

function parsePatternRules(str){
  if(!str) return [];
  return str.split(',').map(s=>s.trim()).filter(Boolean).map(r=>{
    const [substr, role] = r.split('=');
    if(!substr || !role) return null;
    return { match: substr.toLowerCase(), role: role.trim() };
  }).filter(Boolean);
}

async function fetchIdentity(api, account){
  try {
    const opt = await api.query.identity.identityOf(account);
    if(opt && opt.isSome){
      const info = opt.unwrap().info;
      // display may be Raw or Data; toHuman handles multi-language
      const display = info.display && info.display.toHuman ? info.display.toHuman() : (info.display?.raw || '').toString();
      return (display || '').trim();
    }
    return '';
  } catch (e){
    if(argv.verbose) console.error('Identity query failed for', account.toString(), e.message);
    return '';
  }
}

async function main(){
  console.log('🔗 Connecting:', argv.endpoint);
  const api = await ApiPromise.create({ provider: new WsProvider(argv.endpoint) });
  console.log('✅ Connected');

  try {
    const chain = await api.rpc.system.chain();
    console.log('📋 Chain:', chain.toString());

    const validators = await api.query.session.validators();
    console.log(`👥 当前 validator 数量: ${validators.length}`);

    const list = argv.limit ? validators.slice(0, argv.limit) : validators;

    const patterns = parsePatternRules(argv.patterns);
    if(patterns.length){
      console.log('🧩 使用的匹配规则:', patterns.map(p=>`${p.match}=>${p.role}`).join(', '));
    }

    const results = [];
    let processed = 0;
    for(const acc of list){
      const address = acc.toString();
      const display = await fetchIdentity(api, acc);
      const lower = display.toLowerCase();
      let role = argv['default-role'];
      const rule = patterns.find(p=> lower.includes(p.match));
      if(rule) role = rule.role;
      results.push({ address, display, role });
      processed++;
      if(argv.verbose && processed % 10 === 0){
        console.log(`...processed ${processed}/${list.length}`);
      }
    }

    let outputData;
    if(argv.format === 'object'){
      const mapping = {};
      results.forEach(r => { mapping[r.address] = r.role; });
      outputData = mapping;
    } else {
      if(!argv.includeDisplay){
        outputData = results.map(({address, role})=>({address, role}));
      } else {
        outputData = results; // full
      }
    }

    fs.writeFileSync(argv.output, JSON.stringify(outputData, null, 2));
    console.log(`💾 已写入 ${argv.output}`);
    console.log('✅ 完成');
  } finally {
    await api.disconnect();
    console.log('🔌 Disconnected');
  }
}

process.on('unhandledRejection', (r)=>{ console.error('Unhandled rejection', r); process.exit(1);});

main().catch(err=>{ console.error('❌ Error:', err.message); if(argv.verbose) console.error(err); process.exit(1); });

