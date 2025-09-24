#!/usr/bin/env node

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
    describe: 'Reference node used to read validators and session.nextKeys'
  })
  .option('nodes-file', {
    alias: 'n',
    type: 'string',
    demandOption: true,
    describe: 'Text file containing node names and WS endpoints, format: name,ws://endpoint or name ws://endpoint (one per line)'
  })
  .option('out', {
    alias: 'o',
    type: 'string',
    default: 'node-validator-map.json',
    describe: 'Output mapping JSON file'
  })
  .option('max-per-node-keys', {
    type: 'number',
    default: 20,
    describe: 'Maximum number of public keys to try (to prevent excessive RPC calls in extreme cases)'
  })
  .option('concurrency', {
    alias: 'c',
    type: 'number',
    default: 8,
    describe: 'Number of nodes to connect to concurrently for matching'
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Output debug logs'
  })
  .help()
  .alias('help','h')
  .example('$0 -n nodes.txt', 'Read nodes.txt and generate a mapping from node names to validator addresses')
  .example('$0 -n nodes.txt -r wss://kusama-rpc.polkadot.io -o kusama-map.json', 'Specify reference chain and output file')
  .argv;

// Map session.nextKeys field names to author.hasKey keyType
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
  if(!fs.existsSync(path)) throw new Error(`nodes-file does not exist: ${path}`);
  const lines = fs.readFileSync(path,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const entries = [];
  lines.forEach((line,i)=>{
    if(line.startsWith('#')) return; // comment
    let name, endpoint;
    if(line.includes(',')){
      [name, endpoint] = line.split(',').map(s=>s.trim());
    } else {
      [name, endpoint] = line.split(/\s+/);
    }
    if(!name || !endpoint) throw new Error(`Format error at line ${i+1} in nodes-file: ${line}`);
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
  let api; // connect to this node separately
  const { name, endpoint } = nodeEntry;
  try {
    api = await ApiPromise.create({ provider: new WsProvider(endpoint) });
  } catch (e){
    return { name, endpoint, error: `Connection failed: ${e.message}` };
  }
  try {
    if(!api.rpc.author || !api.rpc.author.hasKey){
      return { name, endpoint, error: 'author.hasKey not available (disabled or method missing)' };
    }
    // deduplicate (same validator may have multiple fields) -> by key list
    const candidates = keyIndex.slice(0, argv['max-per-node-keys']);
    for(const { validator, keyType, pubKey, field } of candidates){
      try {
        const has = await api.rpc.author.hasKey(pubKey, keyType);
        if(has.isTrue){
          return { name, endpoint, validator, keyType, pubKey, field };
        }
      } catch (inner){
        if(argv.verbose) console.error(`[${name}] hasKey call failed ${keyType}: ${inner.message}`);
      }
    }
    return { name, endpoint, validator: null };
  } finally {
    try { await api.disconnect(); } catch {}
  }
}

async function main(){
  console.log(`🔗 Connecting to reference node: ${argv['reference-endpoint']}`);
  const refApi = await ApiPromise.create({ provider: new WsProvider(argv['reference-endpoint']) });
  console.log('✅ Reference node connected');
  let keyIndex;
  try {
    keyIndex = await collectValidatorKeyIndex(refApi);
    if(!keyIndex.length){
      console.log('⚠️ No session.nextKeys public keys retrieved; the chain may use a different mechanism or lack permissions.');
    } else {
      console.log(`📦 Collected ${keyIndex.length} (validator, keyType, pubKey) records`);
    }
  } finally {
    await refApi.disconnect();
  }

  const nodes = parseNodesFile(argv['nodes-file']);
  console.log(`🗂 Number of nodes to match: ${nodes.length}`);

  const limit = pLimit(Math.max(1, argv.concurrency));
  const tasks = nodes.map(n => limit(()=>tryMatchNode(n, keyIndex)));
  const results = [];
  let done = 0;
  for(const t of tasks){
    const r = await t;
    results.push(r);
    done++;
    if(argv.verbose || done % 5 === 0){
      console.log(`⏱ Progress ${done}/${nodes.length}`);
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
  console.log(`💾 Mapping file written to ${argv.out}`);
  console.log(`✅ Matched ${success.length} / ${nodes.length}`);
  if(failed.length){
    console.log('⚠️ Unmatched nodes (possible reasons: not a validator, author RPC disabled, different network, limit truncated, no session.keys):');
    failed.forEach(f => console.log(` - ${f.name}@${f.endpoint} ${f.error ? ' => ' + f.error : ''}`));
  }
  console.log('Done');
}

process.on('unhandledRejection', r => { console.error('Unhandled rejection', r); process.exit(1); });

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
