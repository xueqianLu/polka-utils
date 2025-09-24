# polka-utils
Utilities for Polkadot/Substrate chains.

# Install
Use nvm and Node.js v20.

# Usage
## sendtx.js
```
Purpose: Send balance.transfer transactions to a Substrate chain at a specified rate (TPS).
Arguments:
    --ws            WebSocket RPC endpoint (default: ws://127.0.0.1:9944)
    --seed          Sender account seed or mnemonic (default: //Alice)
    --to            Destination address
    --amount        Transfer amount in base unit (e.g. Planck) (default: 1000000000000)
    --tps           Transactions per second (default: 1)
    --duration      Total duration in seconds (mutually exclusive with --totalTxs)
    --totalTxs      Total number of transactions (mutually exclusive with --duration)
    --concurrency   Max concurrent signing/sending (default: 100)
    --nonceAuto     Auto-maintain local nonce cache (default: true)
```
Example:
```
node sendtx.js --ws ws://172.17.0.1:50021 --seed "//Alice" --to "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5" --tps 1 --duration 10
```

## query.js
```
Purpose: Query on-chain info (block / transaction / account)
Arguments:
    --endpoint / -e   WebSocket node endpoint (default: ws://127.0.0.1:9944)
    --block / -b      Query a specific block number
    --transaction / -t  Query a specific transaction hash
    --account / -a    Query account information
```
Examples:

Block query:
```shell
node query.js -e ws://172.17.0.1:50021 -b 10
```

Transaction query:
```shell
node query.js -e ws://172.17.0.1:50021 -t 0x18ab81410da1de49372f58f2c35348133597bf805496d83be376ff01039f147d
```

Account query:
```shell
node query.js -e ws://172.17.0.1:50021 -a "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5"
```

## collect.js
See: [how_to_collect.md](./how_to_collect.md)

---
## docker-compose (4 demo nodes + tx sender + delayed collector)
Added components:
- `Dockerfile`: Builds tool image `polka-utils:latest` containing sendtx.js & collect.js
- `docker-compose.yml`: Example with 4 placeholder nodes (node1..node4); replace commands with your real validator setup. Using `--dev` is only for demonstration and is NOT a real multi-validator network.
- `tx-sender` service: Continuously sends transactions after start (optional wait supported).
- `delayed-collector` service: Sleeps for a configurable delay (default 5h) then runs `collect.js` to aggregate validator block production. Outputs data + metadata files.

### Output directory
- Host path: `./data/collector`
- Result file pattern: `result-<UTC_TIMESTAMP>.json` (or .csv / table output if configured)
- Metadata file: `result-<UTC_TIMESTAMP>.meta.txt` (records parameters & range)

### tx-sender environment variables
| Variable | Description | Default |
|----------|-------------|---------|
| WS_ENDPOINT | WebSocket RPC endpoint | ws://node1:9944 |
| SEED | Sender account seed | //Alice |
| TO | Destination address (REQUIRED) | (placeholder) |
| TPS | Transactions per second | 5 |
| DURATION | Total send duration (seconds) | 3600 |
| AMOUNT | Transfer amount (Planck) | 1000000000000 |
| CONCURRENCY | Concurrency limit | 100 |
| NONCE_AUTO | Maintain local nonce | true |
| WAIT_SECONDS | Extra initial wait before sending | 0 |

### delayed-collector environment variables
| Variable | Description | Default |
|----------|-------------|---------|
| DELAY_SECONDS | Delay before collection (5h=18000) | 18000 |
| WS_ENDPOINT | WebSocket RPC endpoint | ws://node1:9944 |
| START_BLOCK | Start block or special value: `HEAD_AT_SCRIPT_START` / `HEAD_AT_COLLECTION_START` | 1 |
| END_BLOCK | End block (omit = latest) | (empty) |
| OUTPUT_FORMAT | table / json / csv | json |
| RESULT_DIR | Output directory in container | /data/collector |
| BATCH_SIZE | Batch query size | 100 |
| SORT_BY | blocks | blocks |
| MIN_BLOCKS | Minimum block count filter | 0 |
| INCLUDE_EMPTY | Include zero-block validators | false |
| VERBOSE | Verbose logging | false |
| EXTRA_ARGS | Extra passthrough args for collect.js | (empty) |

Special START_BLOCK values:
- HEAD_AT_SCRIPT_START: Capture current head at container script start.
- HEAD_AT_COLLECTION_START: Sleep first, then capture head after delay.

### Quick start
```shell
docker compose build
# IMPORTANT: edit the TO address in docker-compose.yml before starting
docker compose up -d

docker compose logs -f tx-sender
# Collector (runs after delay)
docker compose logs -f delayed-collector
```

### Restart / rebuild
```shell
docker compose restart tx-sender
# Rebuild only utility related images
docker compose build polka-utils-base tx-sender delayed-collector
```

### View results
```shell
ls -l data/collector
cat data/collector/*.meta.txt
```

### Notes
1. The 4 node `--dev` setup is only a placeholder; a real multi-validator network needs a shared chain spec, injected keys, persistent volumes, distinct ports, etc.
2. Replace the placeholder `TO` address with a valid target or transfers will fail.
3. To send a fixed total number of transactions instead of by duration, modify the entrypoint or call directly:
   ```yaml
   entrypoint: ["node","sendtx.js","--ws","ws://node1:9944","--seed","//Alice","--to","<addr>","--totalTxs","1000","--tps","10"]
   ```
4. If the chain restarts and block numbers reset during the waiting window, adjust START_BLOCK / END_BLOCK.
5. `collect.js` currently uses a heuristic for block author (session validators + modulo). For accuracy, implement proper digest parsing or consensus-specific author extraction.

---
