#!/usr/bin/env node

import {ApiPromise, WsProvider} from '@polkadot/api';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import fs from 'fs';
import {firstValueFrom} from 'rxjs';

// Configure command line arguments
const argv = yargs(hideBin(process.argv))
    .option('start-block', {
        alias: 's',
        type: 'number',
        demandOption: true,
        description: 'Starting block number'
    })
    .option('end-block', {
        alias: 'e',
        type: 'number',
        description: 'Ending block number (if not specified, use latest block)'
    })
    .option('endpoint', {
        alias: 'u',
        type: 'string',
        default: 'wss://rpc.polkadot.io',
        description: 'WebSocket RPC endpoint'
    })
    .option('output', {
        alias: 'o',
        type: 'string',
        choices: ['table', 'json', 'csv'],
        default: 'table',
        description: 'Output format'
    })
    .option('batch-size', {
        alias: 'b',
        type: 'number',
        default: 100,
        description: 'Batch query size'
    })
    .option('save-to', {
        alias: 'f',
        type: 'string',
        description: 'Save results to file'
    })
    .option('verbose', {
        alias: 'v',
        type: 'boolean',
        default: false,
        description: 'Verbose output'
    })
    .option('include-empty', {
        type: 'boolean',
        default: false,
        description: 'Include validators with zero blocks produced (ignored when --role is used; role mode always lists provided nodes)'
    })
    .option('sort-by', {
        type: 'string',
        choices: ['blocks', 'validator'],
        default: 'blocks',
        description: 'Sort by (block count or validator name)'
    })
    // role (node mapping) file produced by link-node-names.js
    .option('role', {
        type: 'string',
        description: 'Path to node mapping file (output of link-node-names.js). Only those nodes will be reported.'
    })
    .help()
    .alias('help', 'h')
    .example('$0 -s 1000 -e 2000', 'Query validator stats from block 1000 to 2000 (all validators)')
    .example('$0 -s 1000 --role node-validator-map.json', 'Only report blocks produced by nodes listed in mapping file')
    .example('$0 -s 1000 -o json -f result.json', 'Output JSON and save to a file')
    .argv;

// Progress bar display
function showProgress(current, total, message = '') {
    const percentage = Math.floor((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percentage / 2)) + '░'.repeat(50 - Math.floor(percentage / 2));
    process.stdout.write(`\r[${bar}] ${percentage}% ${message}`);
}

// Parse node mapping produced by link-node-names.js
function loadNodeMapping(filePath) {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Node mapping file not found: ${filePath}`);
        return null;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw);
        if (!Array.isArray(json.nodes)) {
            console.error('❌ Invalid node mapping file: missing nodes array');
            return null;
        }
        // Build validator -> nodeName map (if duplicates keep first)
        const validatorToNode = {};
        const nodes = [];
        json.nodes.forEach(entry => {
            if (entry && entry.validator && entry.name) {
                if (!validatorToNode[entry.validator]) {
                    validatorToNode[entry.validator] = entry.name;
                    nodes.push({ name: entry.name, validator: entry.validator });
                }
            }
        });
        return { validatorToNode, nodesMeta: nodes };
    } catch (e) {
        console.error(`❌ Failed to parse node mapping file: ${e.message}`);
        return null;
    }
}

// Format output (normal per-validator mode)
function formatValidatorOutput(stats, format, options = {}) {
    const sortedStats = Object.entries(stats).sort((a, b) => {
        if (options.sortBy === 'validator') {
            return a[0].localeCompare(b[0]);
        }
        return b[1].blockCount - a[1].blockCount;
    });

    const filteredStats = sortedStats.filter(([_, data]) =>
        true
    );

    switch (format) {
        case 'json':
            return JSON.stringify(Object.fromEntries(filteredStats), null, 2);

        case 'csv': {
            const csvHeader = 'Validator,Block Count,Percentage\n';
            const blockcount = Object.values(stats).reduce((sum, data) => sum + data.blockCount, 0);
            const csvRows = filteredStats.map(([validator, data]) => {
                const percentage = blockcount === 0 ? '0.00' : ((data.blockCount / blockcount) * 100).toFixed(2);
                return `"${validator}",${data.blockCount},${percentage}%`;
            }).join('\n');
            return csvHeader + csvRows;
        }
        case 'table':
        default:
            console.log('\n📊 Validator Block Production Statistics:');
            console.log('='.repeat(80));

            const blockcount = Object.values(stats).reduce((sum, data) => sum + data.blockCount, 0);

            console.log(`${'Validator'.padEnd(50)} ${'Blocks'.padStart(10)} ${'Share'.padStart(10)}`);
            console.log('-'.repeat(80));


            filteredStats.forEach(([validator, data]) => {
                const percentage = blockcount === 0 ? '0.00' : ((data.blockCount / blockcount) * 100).toFixed(2);
                const shortValidator = validator.length > 47 ? validator.substring(0, 47) + '...' : validator;

                console.log(`${shortValidator.padEnd(50)} ${data.blockCount.toString().padStart(10)} ${percentage.padStart(8)}%`);
            });

            console.log('-'.repeat(80));

            console.log(`Total: ${filteredStats.length} validators, ${blockcount} blocks`);
            return '';
    }
}

// Format output (role node mapping mode)
function formatNodeOutput(nodeStats, format) {
    // nodeStats: { nodeName: { validator, blockCount } }
    const entries = Object.entries(nodeStats).sort((a, b) => b[1].blockCount - a[1].blockCount);
    const totalBlocks = entries.reduce((sum, [, v]) => sum + v.blockCount, 0);

    switch (format) {
        case 'json': {
            return JSON.stringify(nodeStats, null, 2);
        }
        case 'csv': {
            const header = 'Node,Validator,Block Count,Percentage\n';
            const rows = entries.map(([name, data]) => {
                const percentage = totalBlocks === 0 ? '0.00' : ((data.blockCount / totalBlocks) * 100).toFixed(2);
                return `"${name}","${data.validator}",${data.blockCount},${percentage}%`;
            }).join('\n');
            return header + rows;
        }
        case 'table':
        default: {
            console.log('\n📊 Node Block Production Statistics (Role Mode):');
            console.log('='.repeat(100));
            console.log(`${'Node'.padEnd(20)} ${'Validator'.padEnd(50)} ${'Blocks'.padStart(10)} ${'Share'.padStart(10)}`);
            console.log('-'.repeat(100));
            entries.forEach(([name, data]) => {
                const percentage = totalBlocks === 0 ? '0.00' : ((data.blockCount / totalBlocks) * 100).toFixed(2);
                const validatorShort = data.validator.length > 47 ? data.validator.substring(0, 47) + '...' : data.validator;
                console.log(`${name.padEnd(20)} ${validatorShort.padEnd(50)} ${data.blockCount.toString().padStart(10)} ${percentage.padStart(8)}%`);
            });
            console.log('-'.repeat(100));
            console.log(`Total nodes: ${entries.length}, Total node blocks: ${totalBlocks}`);
            return '';
        }
    }
}

// Safe wrapper for derive getBlockByNumber accommodating Observable or Promise-like return types
async function deriveBlockByNumber(api, blockNum) {
    const result = api.derive.chain.getBlockByNumber(blockNum);
    // If it looks like an Observable, use firstValueFrom
    if (result && typeof result.subscribe === 'function') {
        return await firstValueFrom(result);
    }
    // Otherwise it may already be a Promise or a direct value
    return await result;
}

async function main() {
    let api = null;

    try {
        const roleMode = !!argv.role;

        console.log('🔗 Connecting to network:', argv.endpoint);
        const provider = new WsProvider(argv.endpoint);
        api = await ApiPromise.create({ provider });
        console.log('✅ Connection successful');

        // Load legacy role mapping only if not in role mode
        const nodeMapping = roleMode ? loadNodeMapping(argv.role) : null;
        if (roleMode && !nodeMapping) {
            throw new Error('Failed to load node mapping file for role mode');
        }

        // Get chain information
        const chain = await api.rpc.system.chain();
        const version = await api.rpc.system.version();
        console.log(`📋 Chain: ${chain}, Version: ${version}`);

        // Determine end block number
        let endBlock = argv.endBlock;
        if (!endBlock) {
            const latestHeader = await api.rpc.chain.getHeader();
            endBlock = latestHeader.number.toNumber();
            console.log(`🎯 Using latest block as end block: ${endBlock}`);
        }

        if (argv.startBlock > endBlock) {
            throw new Error('Start block number cannot be greater than end block number');
        }

        let totalBlocks = endBlock - argv.startBlock + 1;
        console.log(`🔍 Querying block range: ${argv.startBlock} to ${endBlock} (total ${totalBlocks} blocks)`);

        const validatorStats = {}; // { validator: { blockCount, role? } }
        let processedBlocks = 0;

        // Batch processing using derive getBlockByNumber (already includes author extraction)
        for (let i = argv.startBlock; i <= endBlock; i += argv.batchSize) {
            const batchEnd = Math.min(i + argv.batchSize - 1, endBlock);
            const batchPromises = [];

            for (let blockNum = i; blockNum <= batchEnd; blockNum++) {
                batchPromises.push(
                    deriveBlockByNumber(api, blockNum)
                        .then(extended => ({
                            blockNum,
                            author: (extended && extended.author && extended.author.toString()) || 'Unknown'
                        }))
                        .catch(err => ({ blockNum, author: 'Unknown', error: err }))
                );
            }

            const batchResults = await Promise.all(batchPromises);

            for (const { blockNum, author, error } of batchResults) {
                if (error && argv.verbose) {
                    console.log(`\n⚠️ Failed to derive block ${blockNum}: ${error.message}`);
                }

                if (!validatorStats[author]) {
                    validatorStats[author] = { blockCount: 0 };
                }
                validatorStats[author].blockCount++;
                processedBlocks++;

                if (argv.verbose && processedBlocks % 10 === 0) {
                    console.log(`\nProcessing block ${blockNum}, validator: ${author.substring(0, 20)}...`);
                }
            }

            showProgress(processedBlocks, totalBlocks, `Processed ${processedBlocks}/${totalBlocks} blocks`);
        }

        console.log('\n✅ Data collection completed');

        let outputData;
        if (roleMode) {
            // Build nodeStats from node mapping (always list all nodes, even zero)
            const nodeStats = {}; // nodeName -> { validator, blockCount }
            nodeMapping.nodesMeta.forEach(({ name, validator }) => {
                const count = validatorStats[validator]?.blockCount || 0;
                nodeStats[name] = { validator, blockCount: count };
            });
            outputData = formatNodeOutput(nodeStats, argv.output);
            if (argv.saveTo) {
                const saveFmt = argv.saveTo.endsWith('.json') ? 'json' : argv.saveTo.endsWith('.csv') ? 'csv' : argv.output;
                const saveContent = saveFmt === argv.output ? outputData : formatNodeOutput(nodeStats, saveFmt);
                fs.writeFileSync(argv.saveTo, saveContent);
                console.log(`💾 Results saved to: ${argv.saveTo}`);
            }
        } else {
            outputData = formatValidatorOutput(validatorStats, argv.output, {
                sortBy: argv.sortBy,
                minBlocks: argv.minBlocks
            });
            if (argv.saveTo) {
                const fileOutput = formatValidatorOutput(validatorStats,
                    argv.saveTo.endsWith('.json') ? 'json' :
                        argv.saveTo.endsWith('.csv') ? 'csv' : argv.output,
                    { sortBy: argv.sortBy, minBlocks: argv.minBlocks }
                );
                fs.writeFileSync(argv.saveTo, fileOutput);
                console.log(`💾 Results saved to: ${argv.saveTo}`);
            }
        }

        if (outputData) {
            console.log(outputData);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (argv.verbose) {
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        if (api) {
            await api.disconnect();
            console.log('🔌 Connection disconnected');
        }
    }
}

// Graceful exit handling
process.on('SIGINT', async () => {
    console.log('\n👋 Received interrupt signal, cleaning up...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise rejection:', reason);
    process.exit(1);
});

// Run main function
main().catch(console.error);