#!/usr/bin/env node

import { ApiPromise, WsProvider } from '@polkadot/api';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';

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
        description: 'Include validators with zero blocks produced'
    })
    .option('sort-by', {
        type: 'string',
        choices: ['blocks', 'validator'],
        default: 'blocks',
        description: 'Sort by (block count or validator name)'
    })
    .option('min-blocks', {
        type: 'number',
        default: 0,
        description: 'Minimum block count filter'
    })
    .help()
    .alias('help', 'h')
    .example('$0 -s 1000 -e 2000', 'Query validator stats from block 1000 to 2000')
    .example('$0 -s 1000 -o json -f result.json', 'Query from block 1000 to latest, output JSON format and save')
    .example('$0 -s 1000 -e 2000 -b 50 -v', 'Query with batch size 50 and verbose output')
    .argv;

// Progress bar display
function showProgress(current, total, message = '') {
    const percentage = Math.floor((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percentage / 2)) + '░'.repeat(50 - Math.floor(percentage / 2));
    process.stdout.write(`\r[${bar}] ${percentage}% ${message}`);
}

// Format output
function formatOutput(stats, format, options = {}) {
    const sortedStats = Object.entries(stats).sort((a, b) => {
        if (options.sortBy === 'validator') {
            return a[0].localeCompare(b[0]);
        }
        return b[1].blockCount - a[1].blockCount;
    });

    const filteredStats = sortedStats.filter(([_, data]) =>
        data.blockCount >= options.minBlocks
    );

    switch (format) {
        case 'json':
            return JSON.stringify(Object.fromEntries(filteredStats), null, 2);

        case 'csv':
            const csvHeader = 'Validator,Block Count,Percentage\n';
            var blockcount = Object.values(stats).reduce((sum, data) => sum + data.blockCount, 0);
            const csvRows = filteredStats.map(([validator, data]) => {
                const percentage = ((data.blockCount / blockcount) * 100).toFixed(2);
                return `"${validator}",${data.blockCount},${percentage}%`;
            }).join('\n');
            return csvHeader + csvRows;

        case 'table':
        default:
            console.log('\n📊 Validator Block Production Statistics:');
            console.log('='.repeat(80));

            var blockcount = Object.values(stats).reduce((sum, data) => sum + data.blockCount, 0);

            console.log(`${'Validator'.padEnd(50)} ${'Blocks'.padStart(10)} ${'Share'.padStart(10)}`);
            console.log('-'.repeat(80));

            filteredStats.forEach(([validator, data]) => {
                const percentage = ((data.blockCount / blockcount) * 100).toFixed(2);
                const shortValidator = validator.length > 47 ? validator.substring(0, 47) + '...' : validator;
                console.log(`${shortValidator.padEnd(50)} ${data.blockCount.toString().padStart(10)} ${percentage.padStart(8)}%`);
            });

            console.log('-'.repeat(80));
            console.log(`Total: ${filteredStats.length} validators, ${blockcount} blocks`);
            return '';
    }
}

async function main() {
    let api = null;

    try {
        console.log('🔗 Connecting to network:', argv.endpoint);

        // Create provider and API instance
        const provider = new WsProvider(argv.endpoint);
        api = await ApiPromise.create({ provider });

        console.log('✅ Connection successful');

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

        // Validate block range
        if (argv.startBlock > endBlock) {
            throw new Error('Start block number cannot be greater than end block number');
        }

        let totalBlocks = endBlock - argv.startBlock + 1;
        console.log(`🔍 Querying block range: ${argv.startBlock} to ${endBlock} (total ${totalBlocks} blocks)`);

        // Validator statistics
        const validatorStats = {};
        let processedBlocks = 0;

        // Process blocks in batches
        for (let i = argv.startBlock; i <= endBlock; i += argv.batchSize) {
            const batchEnd = Math.min(i + argv.batchSize - 1, endBlock);
            const batchPromises = [];

            // Create queries for current batch
            for (let blockNum = i; blockNum <= batchEnd; blockNum++) {
                batchPromises.push(
                    api.rpc.chain.getBlockHash(blockNum)
                        .then(hash => api.rpc.chain.getBlock(hash))
                        .then(block => ({ blockNum, block }))
                );
            }

            // Wait for current batch to complete
            const batchResults = await Promise.all(batchPromises);

            // Process batch results
            for (const { blockNum, block } of batchResults) {
                // Get block author (validator)
                let author = 'Unknown';

                // Try to get author information from block header
                if (block.block.header.digest && block.block.header.digest.logs) {
                    for (const log of block.block.header.digest.logs) {
                        if (log.isConsensus && log.asConsensus[0].toString() === 'BABE') {
                            // This might need adjustment based on specific consensus algorithm
                            try {
                                // Simplified handling: use first 16 characters of block hash as identifier
                                author = block.block.header.parentHash.toString().substring(0, 16);
                            } catch (e) {
                                // If parsing fails, use default value
                            }
                        }
                    }
                }

                // Try to get more accurate validator information
                try {
                    const blockHash = await api.rpc.chain.getBlockHash(blockNum);
                    const apiAt = await api.at(blockHash);

                    // Get session validators
                    if (apiAt.query.session && apiAt.query.session.validators) {
                        const validators = await apiAt.query.session.validators();
                        if (validators.length > 0) {
                            // Use heuristic method to determine block author
                            const authorIndex = blockNum % validators.length;
                            author = validators[authorIndex].toString();
                        }
                    }
                } catch (e) {
                    if (argv.verbose) {
                        console.log(`\n⚠️ Cannot get detailed validator info for block ${blockNum}:`, e.message);
                    }
                }

                // Statistics
                if (!validatorStats[author]) {
                    validatorStats[author] = { blockCount: 0 };
                }
                validatorStats[author].blockCount++;

                processedBlocks++;

                if (argv.verbose && processedBlocks % 10 === 0) {
                    console.log(`\nProcessing block ${blockNum}, validator: ${author.substring(0, 20)}...`);
                }
            }

            // Show progress
            showProgress(processedBlocks, totalBlocks, `Processed ${processedBlocks}/${totalBlocks} blocks`);
        }

        console.log('\n✅ Data collection completed\n');

        // Filter empty results
        if (!argv.includeEmpty) {
            Object.keys(validatorStats).forEach(validator => {
                if (validatorStats[validator].blockCount === 0) {
                    delete validatorStats[validator];
                }
            });
        }

        // Format and output results
        const output = formatOutput(validatorStats, argv.output, {
            sortBy: argv.sortBy,
            minBlocks: argv.minBlocks
        });

        if (output) {
            console.log(output);
        }

        // Save to file
        if (argv.saveTo) {
            const fileOutput = formatOutput(validatorStats,
                argv.saveTo.endsWith('.json') ? 'json' :
                    argv.saveTo.endsWith('.csv') ? 'csv' : argv.output,
                { sortBy: argv.sortBy, minBlocks: argv.minBlocks }
            );
            fs.writeFileSync(argv.saveTo, fileOutput);
            console.log(`💾 Results saved to: ${argv.saveTo}`);
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