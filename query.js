#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { formatBalance } from '@polkadot/util';

// Default local node address
const DEFAULT_WS_ENDPOINT = 'ws://localhost:9944';

class PolkaQuery {
    constructor(endpoint = DEFAULT_WS_ENDPOINT) {
        this.endpoint = endpoint;
        this.api = null;
    }

    async connect() {
        try {
            const wsProvider = new WsProvider(this.endpoint);
            this.api = await ApiPromise.create({ provider: wsProvider });

            const chain = await this.api.rpc.system.chain();
            const version = await this.api.rpc.system.version();

            console.log(`✅ Connected to ${chain} (version: ${version})`);
            console.log(`🔗 Node endpoint: ${this.endpoint}\n`);

            return true;
        } catch (error) {
            console.error(`❌ Connection failed: ${error.message}`);
            return false;
        }
    }

    async disconnect() {
        if (this.api) {
            await this.api.disconnect();
            console.log('\n🔌 Disconnected');
        }
    }

    // Query block information
    async queryBlock(blockNumber) {
        try {
            console.log(`🔍 Querying block #${blockNumber}...\n`);

            // Get block hash
            const blockHash = await this.api.rpc.chain.getBlockHash(blockNumber);

            if (blockHash.isEmpty) {
                console.log(`❌ Block #${blockNumber} does not exist`);
                return;
            }

            // Get block details
            const block = await this.api.rpc.chain.getBlock(blockHash);
            const header = block.block.header;
            const extrinsics = block.block.extrinsics;

            // Get block events
            const events = await this.api.query.system.events.at(blockHash);

            console.log(`📦 Block Information:`);
            console.log(`   Block Number: #${header.number}`);
            console.log(`   Block Hash: ${blockHash.toHex()}`);
            console.log(`   Parent Hash: ${header.parentHash.toHex()}`);
            console.log(`   State Root: ${header.stateRoot.toHex()}`);
            console.log(`   Extrinsics Root: ${header.extrinsicsRoot.toHex()}`);
            console.log(`   Extrinsics Count: ${extrinsics.length}`);
            console.log(`   Events Count: ${events.length}\n`);

            // Display extrinsics information
            // if (extrinsics.length > 0) {
            //     console.log(`📋 Extrinsics List:`);
            //     extrinsics.forEach((ex, index) => {
            //         const method = ex.method;
            //         const signer = ex.isSigned ? ex.signer.toString() : 'Unsigned';
            //         const hash = ex.hash.toHex();
            //
            //         console.log(`   [${index}] ${method.section}.${method.method}`);
            //         console.log(`       Hash: ${hash}`);
            //         console.log(`       Signer: ${signer}`);
            //         console.log(`       Args: ${JSON.stringify(method.args, null, 2)}\n`);
            //     });
            // }

            // Display important events
            const importantEvents = events.filter(({ event }) =>
                !['system.ExtrinsicSuccess', 'system.ExtrinsicFailed'].includes(`${event.section}.${event.method}`)
            );

            if (importantEvents.length > 0) {
                console.log(`📢 Important Events:`);
                importantEvents.forEach(({ event }, index) => {
                    console.log(`   [${index}] ${event.section}.${event.method}`);
                    console.log(`       Data: ${JSON.stringify(event.data.toHuman(), null, 2)}\n`);
                });
            }

        } catch (error) {
            console.error(`❌ Block query failed: ${error.message}`);
        }
    }

    // Query transaction information
    async queryTransaction(txHash) {
        try {
            console.log(`🔍 Querying transaction ${txHash}...\n`);

            // Search for the block containing this transaction
            let found = false;
            const latestBlock = await this.api.rpc.chain.getHeader();
            const latestBlockNumber = latestBlock.number.toNumber();

            // Search backwards from the latest block (up to 1000 blocks)
            const searchLimit = Math.max(0, latestBlockNumber - 1000);

            for (let blockNum = latestBlockNumber; blockNum >= searchLimit; blockNum--) {
                try {
                    const blockHash = await this.api.rpc.chain.getBlockHash(blockNum);
                    const block = await this.api.rpc.chain.getBlock(blockHash);

                    const extrinsicIndex = block.block.extrinsics.findIndex(ex =>
                        ex.hash.toHex() === txHash
                    );

                    if (extrinsicIndex !== -1) {
                        found = true;
                        const extrinsic = block.block.extrinsics[extrinsicIndex];
                        const events = await this.api.query.system.events.at(blockHash);

                        // Find events related to this transaction
                        const txEvents = events.filter(({ phase }) =>
                            phase.isApplyExtrinsic && phase.asApplyExtrinsic.toNumber() === extrinsicIndex
                        );

                        console.log(`✅ Transaction found!`);
                        console.log(`📦 Block: #${blockNum}`);
                        console.log(`📍 Extrinsic Index: ${extrinsicIndex}`);
                        console.log(`🔗 Transaction Hash: ${txHash}`);
                        console.log(`📝 Method: ${extrinsic.method.section}.${extrinsic.method.method}`);
                        console.log(`👤 Signer: ${extrinsic.isSigned ? extrinsic.signer.toString() : 'Unsigned'}`);
                        console.log(`💰 Tip: ${extrinsic.tip?.toHuman() || '0'}`);
                        console.log(`🔢 Nonce: ${extrinsic.nonce?.toHuman() || 'N/A'}`);
                        console.log(`📊 Args:`);
                        console.log(JSON.stringify(extrinsic.method.args, null, 2));

                        if (txEvents.length > 0) {
                            console.log(`\n📢 Related Events:`);
                            txEvents.forEach(({ event }, index) => {
                                console.log(`   [${index}] ${event.section}.${event.method}`);
                                console.log(`       Data: ${JSON.stringify(event.data.toHuman(), null, 2)}`);
                            });
                        }
                        break;
                    }
                } catch (error) {
                    // Ignore single block query errors, continue searching
                    continue;
                }

                // Show progress every 100 blocks
                if (blockNum % 100 === 0) {
                    console.log(`🔍 Searching... Current block #${blockNum}`);
                }
            }

            if (!found) {
                console.log(`❌ Transaction ${txHash} not found in the last 1000 blocks`);
                console.log(`💡 Tip: The transaction might be in earlier blocks, or the hash is incorrect`);
            }

        } catch (error) {
            console.error(`❌ Transaction query failed: ${error.message}`);
        }
    }

    // Query account information
    async queryAccount(address) {
        try {
            console.log(`🔍 Querying account ${address}...\n`);

            // Get basic account information
            const account = await this.api.query.system.account(address);
            const chainDecimals = this.api.registry.chainDecimals[0] || 12;
            const chainToken = this.api.registry.chainTokens[0] || 'DOT';

            // Set formatting options
            formatBalance.setDefaults({
                decimals: chainDecimals,
                unit: chainToken
            });

            console.log(`👤 Account Information:`);
            console.log(`   Address: ${address}`);
            console.log(`   Nonce: ${account.nonce}`);
            console.log(`   Balance Information:`);
            console.log(`     Free Balance: ${formatBalance(account.data.free)}`);
            console.log(`     Reserved Balance: ${formatBalance(account.data.reserved)}`);
            console.log(`     Frozen Balance: ${formatBalance(account.data.frozen)}`);
            console.log(`     Total Balance: ${formatBalance(account.data.free.add(account.data.reserved))}\n`);

            // Query staking information (if it's a staking account)
            try {
                const stakingLedger = await this.api.query.staking.ledger(address);
                if (!stakingLedger.isEmpty) {
                    const ledger = stakingLedger.unwrap();
                    console.log(`🏛️ Staking Information:`);
                    console.log(`   Stash Controller: ${ledger.stash}`);
                    console.log(`   Active Stake: ${formatBalance(ledger.active)}`);
                    console.log(`   Total Stake: ${formatBalance(ledger.total)}`);
                }
            } catch (stakingError) {
                // Ignore staking query errors
            }

            // Query nominator information
            try {
                const nominators = await this.api.query.staking.nominators(address);
                if (!nominators.isEmpty) {
                    const nominator = nominators.unwrap();
                    console.log(`🗳️ Nomination Information:`);
                    console.log(`   Nominated Validators:`);
                    nominator.targets.forEach((validator, index) => {
                        console.log(`     [${index}] ${validator.toString()}`);
                    });
                    console.log(`   Submitted in Era: ${nominator.submittedIn}`);
                }
            } catch (nominatorError) {
                // Ignore nominator query errors
            }

            // Query identity information
            try {
                const identity = await this.api.query.identity.identityOf(address);
                if (!identity.isEmpty) {
                    const info = identity.unwrap().info;
                    console.log(`🆔 Identity Information:`);
                    if (!info.display.isNone) {
                        console.log(`   Display Name: ${info.display.asRaw.toUtf8()}`);
                    }
                    if (!info.web.isNone) {
                        console.log(`   Website: ${info.web.asRaw.toUtf8()}`);
                    }
                    if (!info.email.isNone) {
                        console.log(`   Email: ${info.email.asRaw.toUtf8()}`);
                    }
                }
            } catch (identityError) {
                // Ignore identity query errors
            }

        } catch (error) {
            console.error(`❌ Account query failed: ${error.message}`);
        }
    }
}

// Main function
async function main() {
    const argv = yargs(hideBin(process.argv))
        .usage('Usage: $0 [options]')
        .option('endpoint', {
            alias: 'e',
            type: 'string',
            default: DEFAULT_WS_ENDPOINT,
            describe: 'WebSocket node endpoint'
        })
        .option('block', {
            alias: 'b',
            type: 'number',
            describe: 'Query information for the specified block number'
        })
        .option('transaction', {
            alias: 't',
            type: 'string',
            describe: 'Query information for the specified transaction hash'
        })
        .option('account', {
            alias: 'a',
            type: 'string',
            describe: 'Query information for the specified account address'
        })
        .example('$0 -b 12345', 'Query information for block #12345')
        .example('$0 -t 0x1234...', 'Query information for transaction hash')
        .example('$0 -a 1A1zP1eP...', 'Query information for account address')
        .example('$0 -e ws://127.0.0.1:9944 -b 100', 'Connect to specified node and query block')
        .help('h')
        .alias('h', 'help')
        .argv;

    const query = new PolkaQuery(argv.endpoint);

    // Connect to node
    const connected = await query.connect();
    if (!connected) {
        process.exit(1);
    }

    try {
        // Execute queries based on parameters
        if (argv.block !== undefined) {
            await query.queryBlock(argv.block);
        } else if (argv.transaction) {
            await query.queryTransaction(argv.transaction);
        } else if (argv.account) {
            await query.queryAccount(argv.account);
        } else {
            console.log('❌ Please provide query parameters (--block, --transaction, or --account)');
            console.log('Use --help to see usage');
        }
    } finally {
        await query.disconnect();
    }
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\n👋 Received interrupt signal, exiting...');
    process.exit(0);
});

// Run main function
main().catch(console.error);