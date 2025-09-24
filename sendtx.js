#!/usr/bin/env node

/**
 * sendtx.js
 *
 * Purpose: Send balance.transfer transactions to a Substrate chain at a specified rate (TPS).
 *
 * Arguments (yargs style):
 *  --ws           WebSocket RPC endpoint (default: ws://127.0.0.1:9944)
 *  --seed         Sender account seed or mnemonic (default: //Alice)
 *  --to           Destination address (you can invoke multiple times with different targets or randomize externally)
 *  --amount       Transfer amount in the chain base unit (e.g. Planck) (default: 1000000000000)
 *  --tps          Transactions per second (default: 1)
 *  --duration     Total sending duration in seconds (mutually exclusive with --totalTxs)
 *  --totalTxs     Total number of transactions to send (mutually exclusive with --duration)
 *  --concurrency  Max number of concurrent signing/sending tasks (default: 100)
 *  --nonceAuto    Whether to auto-read and maintain a local nonce counter (true/false, default true)
 *
 * Example:
 *  node sendtx.js --ws ws://127.0.0.1:9944 --seed "//Alice" --to "<dest>" --tps 10 --duration 60
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import pLimit from 'p-limit';

(async () => {
    const argv = yargs(hideBin(process.argv))
        .option('ws', { type: 'string', default: 'ws://127.0.0.1:9944' })
        .option('seed', { type: 'string', default: '//Alice' })
        .option('to', { type: 'string', demandOption: true })
        .option('amount', { type: 'string', default: '1000000000000' })
        .option('tps', { type: 'number', default: 1 })
        .option('duration', { type: 'number' })
        .option('totalTxs', { type: 'number' })
        .option('concurrency', { type: 'number', default: 100 })
        .option('nonceAuto', { type: 'boolean', default: true })
        .argv;

    if (!argv.duration && !argv.totalTxs) {
        console.error('please provide --duration or --totalTxs ');
        process.exit(1);
    }
    if (argv.duration && argv.totalTxs) {
        console.error('can\'t provide --duration and --totalTxs together');
        process.exit(1);
    }

    const ws = argv.ws;
    const tps = argv.tps;
    const duration = argv.duration;
    const totalTxs = argv.totalTxs;
    const concurrency = argv.concurrency;
    const amount = argv.amount;
    const dest = argv.to;
    const seed = argv.seed;
    const nonceAuto = argv.nonceAuto;

    console.log(`Connecting to ${ws} ...`);
    const provider = new WsProvider(ws);
    const api = await ApiPromise.create({ provider });

    // Keyring and account
    const keyring = new Keyring({ type: 'sr25519' });
    const sender = keyring.addFromUri(seed);
    console.log(`Using sender: ${sender.address}`);

    // Get chain info for fee calculation if needed
    const chain = await api.rpc.system.chain();
    console.log(`Connected to chain: ${chain}`);

    // optional: maintain nonce manually for higher throughput
    let currentNonce = null;
    if (nonceAuto) {
        currentNonce = (await api.query.system.account(sender.address)).nonce.toNumber();
        console.log(`Starting nonce (auto-read): ${currentNonce}`);
    }

    let sent = 0;
    let succeeded = 0;
    let failed = 0;

    const limit = pLimit(concurrency);

    // Helper to send one tx
    async function sendOne(index) {
        try {
            // Determine nonce
            let nonceForThis = null;
            if (nonceAuto) {
                nonceForThis = currentNonce++;
            } else {
                // use api.rpc.author.submitAndWatchExtrinsic or let polkadot API handle nonce
                nonceForThis = (await api.rpc.system.accountNextIndex(sender.address)).toNumber(); // fallback
            }

            // Construct transfer
            const tx = api.tx.balances.transfer(dest, amount);

            // Sign & send: using signAndSend with explicit nonce and status callbacks
            return new Promise((resolve, reject) => {
                const opts = { nonce: nonceForThis };
                const unsubPromise = tx.signAndSend(sender, opts, (result) => {
                    if (result.status.isInBlock) {
                        succeeded++;
                        sent++;
                        console.log(`Tx #${index} included in block. Hash: ${tx.hash.toHex()}`);
                        // console.log(`Tx #${index} included at ${result.status.asInBlock}`);
                        resolve({ status: 'inBlock', hash: tx.hash?.toHex?.() });
                    } else if (result.status.isFinalized) {
                        // finalized
                        // console.log(`Tx #${index} finalized`);
                        // We already counted on inBlock
                    } else if (result.isError) {
                        failed++;
                        sent++;
                        reject(new Error('Unknown tx error status'));
                    }
                }).catch((err) => {
                    failed++;
                    sent++;
                    reject(err);
                });
            });
        } catch (err) {
            failed++;
            sent++;
            throw err;
        }
    }

    // Scheduler: send at tps for duration OR until totalTxs reached
    const intervalMs = 1000 / tps;
    let plannedTotal = totalTxs ?? Math.ceil(duration * tps);
    console.log(`Planned total txs: ${plannedTotal} (tps=${tps}, interval=${intervalMs}ms)`);

    const startTime = Date.now();
    let index = 0;

    const promises = [];

    function scheduleTick() {
        if (index >= plannedTotal) return false;
        // send one tx (but we respect concurrency via pLimit)
        const i = index++;
        const p = limit(() => sendOne(i).catch((e) => {
            console.error(`Tx #${i} failed: ${e.message || e}`);
        }));
        promises.push(p);
        return true;
    }

    // Strict timing loop: schedule every intervalMs until planned total or duration elapsed
    let nextTime = Date.now();
    while (index < plannedTotal) {
        const now = Date.now();
        if (now >= nextTime) {
            // schedule up to floor((now-nextTime)/intervalMs)+1 in case of lag
            scheduleTick();
            nextTime += intervalMs;
        } else {
            // sleep a bit
            await new Promise(r => setTimeout(r, Math.max(0, nextTime - now)));
        }

        // If duration provided, break when elapsed
        if (duration && (Date.now() - startTime) / 1000 >= duration) {
            console.log('Duration reached, stopping scheduling new txs.');
            break;
        }
    }

    // wait for all pending promises to settle
    await Promise.allSettled(promises);

    const elapsed = (Date.now() - startTime) / 1000;
    console.log('---- Summary ----');
    console.log(`Time elapsed: ${elapsed}s`);
    console.log(`Attempted: ${index}`);
    console.log(`Sent attempts: ${sent}`);
    console.log(`Succeeded (inBlock): ${succeeded}`);
    console.log(`Failed: ${failed}`);

    await api.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});