#!/usr/bin/env node

import { ApiPromise, WsProvider } from '@polkadot/api';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Configure command line arguments
const argv = yargs(hideBin(process.argv))
    .option('endpoint', {
        alias: 'e',
        type: 'string',
        description: 'Polkadot node WebSocket endpoint',
        default: 'ws://172.17.0.1:9944'
    })
    .option('era', {
        alias: 'era',
        type: 'number',
        description: 'Query validator rewards for a specific era'
    })
    .option('era-range', {
        alias: 'r',
        type: 'string',
        description: 'Era range in format: start-end (e.g., 1000-1010)'
    })
    .option('validator', {
        alias: 'v',
        type: 'string',
        description: 'Specific validator address (optional)'
    })
    .option('latest', {
        alias: 'l',
        type: 'boolean',
        description: 'Query rewards for the latest era',
        default: false
    })
    .option('count', {
        alias: 'c',
        type: 'number',
        description: 'Query rewards for the latest N eras',
        default: 1
    })
    .help()
    .alias('help', 'h')
    .example('$0 --latest', 'Query validator rewards for the latest era')
    .example('$0 --era 1000', 'Query validator rewards for era 1000')
    .example('$0 --era-range 1000-1005', 'Query validator rewards for era range 1000-1005')
    .example('$0 --validator 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY --count 5', 'Query specific validator rewards for the latest 5 eras')
    .check((argv) => {
        const { era, eraRange, latest, count } = argv;
        const queryMethods = [era, eraRange, latest, count > 1].filter(Boolean);

        if (queryMethods.length === 0) {
            throw new Error('Please specify at least one query method: --era, --era-range, --latest, or --count');
        }

        return true;
    })
    .argv;

// Format DOT amount for display
function formatDot(amount) {
    const dot = amount / Math.pow(10, 10); // Polkadot uses 10 decimal places
    return dot.toFixed(4) + ' DOT';
}

// Format percentage
function formatPercentage(value, total) {
    if (total === 0) return '0.00%';
    return ((value / total) * 100).toFixed(2) + '%';
}

// Query validator rewards for a single era
async function queryEraValidatorRewards(api, eraIndex, specificValidator = null) {
    console.log(`\n=== Era ${eraIndex} Validator Rewards Query ===`);

    try {
        // Query era total rewards
        const eraValidatorReward = await api.query.staking.erasValidatorReward(eraIndex);
        if (eraValidatorReward.isEmpty) {
            console.log(`Era ${eraIndex} has no reward data (may not be finished or rewards not distributed yet)`);
            return;
        }

        const totalReward = eraValidatorReward.unwrap();
        console.log(`Era Total Rewards: ${formatDot(totalReward)}`);

        // Query era reward points distribution
        const eraRewardPoints = await api.query.staking.erasRewardPoints(eraIndex);
        if (eraRewardPoints.isEmpty) {
            console.log(`Era ${eraIndex} has no points data`);
            return;
        }

        const rewardPoints = eraRewardPoints.unwrap();
        const totalPoints = rewardPoints.total.toNumber();
        const individualPoints = rewardPoints.individual;

        console.log(`Era Total Points: ${totalPoints.toLocaleString()}`);
        console.log(`Active Validators: ${individualPoints.size}`);

        // Query validator exposure (validator and their nominator info)
        const eraStakers = await api.query.staking.erasStakers.entries(eraIndex);

        const validatorRewards = [];

        // Process each validator
        for (const [storageKey, exposure] of eraStakers) {
            const validatorId = storageKey.args[1].toString();

            // If specific validator is specified, only process that validator
            if (specificValidator && validatorId !== specificValidator) {
                continue;
            }

            const points = individualPoints.get(validatorId);
            if (!points) {
                continue; // This validator did not earn points in this era
            }

            const validatorPoints = points.toNumber();
            const validatorReward = totalReward.mul(points).div(rewardPoints.total);

            // Get validator information
            const exposureData = exposure.unwrap();
            const validatorStake = exposureData.own;
            const totalStake = exposureData.total;
            const nominatorCount = exposureData.others.length;

            // Get validator commission
            const prefs = await api.query.staking.erasValidatorPrefs(eraIndex, validatorId);
            const commission = prefs.isEmpty ? 0 : prefs.unwrap().commission.toNumber() / 10000000; // Convert to percentage

            validatorRewards.push({
                validatorId,
                points: validatorPoints,
                pointsPercentage: formatPercentage(validatorPoints, totalPoints),
                reward: validatorReward,
                commission: (commission * 100).toFixed(2) + '%',
                ownStake: validatorStake,
                totalStake: totalStake,
                nominatorCount
            });
        }

        // Sort by reward amount (descending)
        validatorRewards.sort((a, b) => b.reward.cmp(a.reward));

        // Display results
        console.log('\n--- Validator Rewards Details ---');
        console.log('Rank | Validator Address | Rewards | Points | Points % | Commission | Nominators');
        console.log(''.padEnd(100, '-'));

        validatorRewards.forEach((validator, index) => {
            const rank = (index + 1).toString().padStart(3);
            const validatorAddr = validator.validatorId.slice(0, 8) + '...';
            const reward = formatDot(validator.reward).padStart(12);
            const points = validator.points.toLocaleString().padStart(8);
            const pointsPerc = validator.pointsPercentage.padStart(7);
            const commission = validator.commission.padStart(6);
            const nominators = validator.nominatorCount.toString().padStart(4);

            console.log(`${rank} | ${validatorAddr.padEnd(12)} | ${reward} | ${points} | ${pointsPerc} | ${commission} | ${nominators}`);
        });

        if (validatorRewards.length === 0) {
            console.log('No validators received rewards in this era');
        }

    } catch (error) {
        console.error(`Error querying era ${eraIndex}:`, error.message);
    }
}

// Main function
async function main() {
    console.log('Connecting to Polkadot network...');
    console.log(`Endpoint: ${argv.endpoint}`);

    const provider = new WsProvider(argv.endpoint);
    const api = await ApiPromise.create({ provider });

    console.log(`Connected to: ${await api.runtimeChain} (${await api.runtimeVersion.specName})`);

    try {
        let erasToQuery = [];
        // console.log('dump query.staking', api.query.staking.activeEra);
        // const overview = await api.query.staking.overview();
        // console.log(`Staking Overview:`, overview);
        // nextAuthorities(): Vec<(SpConsensusBabeAppPublic,u64)>

        const nextauties = await api.query.babe.nextAuthorities();
        for (const [key, val] of nextauties) {
            console.log(`Next Authority: ${key.toString()} with weight ${val.toString()}`);
        }

        // Get current era
        const currentSlot = await api.query.babe.currentSlot();
        console.log(`Fetching current slot...`, currentSlot);
        const currentEraNumber = currentEra.unwrap().toNumber();
        console.log(`Current Era: ${currentEraNumber}`);

        // Determine era range to query
        if (argv.era) {
            erasToQuery = [argv.era];
        } else if (argv.eraRange) {
            const [start, end] = argv.eraRange.split('-').map(Number);
            if (isNaN(start) || isNaN(end) || start > end) {
                throw new Error('Invalid era range format, should be: start-end (e.g., 1000-1010)');
            }
            erasToQuery = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        } else if (argv.latest) {
            // Query the latest completed era (usually current era - 1)
            erasToQuery = [Math.max(0, currentEraNumber - 1)];
        } else if (argv.count > 1) {
            // Query the latest N eras
            const startEra = Math.max(0, currentEraNumber - argv.count);
            erasToQuery = Array.from({ length: argv.count }, (_, i) => startEra + i);
        }

        console.log(`\nEras to query: ${erasToQuery.join(', ')}`);

        // Execute queries
        for (const era of erasToQuery) {
            await queryEraValidatorRewards(api, era, argv.validator);
        }

        // If querying multiple eras, show summary information
        if (erasToQuery.length > 1) {
            console.log(`\n=== Summary ===`);
            console.log(`Era Range Queried: ${erasToQuery[0]} - ${erasToQuery[erasToQuery.length - 1]}`);
            console.log(`Total Eras: ${erasToQuery.length}`);

            if (argv.validator) {
                console.log(`Specific Validator: ${argv.validator}`);
            }
        }

    } catch (error) {
        console.error('Error during query execution:', error.message);
    } finally {
        await api.disconnect();
        console.log('\nConnection disconnected');
    }
}

// Handle errors and exit
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
    process.exit(1);
});

process.on('SIGINT', () => {
    console.log('\nReceived interrupt signal, exiting...');
    process.exit(0);
});

// Run main function
main().catch(console.error);