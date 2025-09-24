#!/bin/sh
# Run collect.js after an optional delay (default 5h) and write stats to a file.
set -e

DELAY_SECONDS=${DELAY_SECONDS:-18000} # 5 * 3600
WS_ENDPOINT=${WS_ENDPOINT:-ws://node1:9944}
START_BLOCK=${START_BLOCK:-1} # Can be number | HEAD_AT_SCRIPT_START | HEAD_AT_COLLECTION_START
END_BLOCK=${END_BLOCK:-}       # Optional explicit end block (number)
OUTPUT_FORMAT=${OUTPUT_FORMAT:-json} # table|json|csv (collect.js supports these)
RESULT_DIR=${RESULT_DIR:-/data/collector}
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
OUTPUT_FILE=${OUTPUT_FILE:-$RESULT_DIR/result-${TIMESTAMP}.${OUTPUT_FORMAT}}
BATCH_SIZE=${BATCH_SIZE:-100}
SORT_BY=${SORT_BY:-blocks}
MIN_BLOCKS=${MIN_BLOCKS:-0}
INCLUDE_EMPTY=${INCLUDE_EMPTY:-false}
VERBOSE=${VERBOSE:-false}
EXTRA_ARGS=${EXTRA_ARGS:-} # Pass-through extra args for collect.js
META_FILE=${META_FILE:-$RESULT_DIR/result-${TIMESTAMP}.meta.txt}

mkdir -p "$RESULT_DIR"

fetch_head() {
  node -e "(async()=>{const { ApiPromise, WsProvider } = await import('@polkadot/api');const api=await ApiPromise.create({provider:new WsProvider('$WS_ENDPOINT')});const h=await api.rpc.chain.getHeader();console.log(h.number.toNumber());await api.disconnect();})().catch(e=>{console.error(e);process.exit(2);});" 2>/dev/null
}

resolve_start_block() {
  case "$START_BLOCK" in
    HEAD_AT_SCRIPT_START)
      FETCHED=$(fetch_head || true)
      if [ -n "$FETCHED" ]; then echo "$FETCHED"; else echo 1; fi
      ;;
    HEAD_AT_COLLECTION_START)
      # Will be resolved after sleep
      echo "__DEFERRED__"
      ;;
    *)
      echo "$START_BLOCK"
      ;;
  esac
}

INITIAL_START_BLOCK=$(resolve_start_block)

if [ "$INITIAL_START_BLOCK" != "__DEFERRED__" ]; then
  RESOLVED_START_BLOCK=$INITIAL_START_BLOCK
fi

echo "[run-collector] Sleeping for $DELAY_SECONDS seconds before starting collection..."
sleep "$DELAY_SECONDS"

if [ "$INITIAL_START_BLOCK" = "__DEFERRED__" ]; then
  RESOLVED_START_BLOCK=$(fetch_head || echo 1)
fi

# Build command args
CMD_ARGS="-s $RESOLVED_START_BLOCK -u $WS_ENDPOINT -o $OUTPUT_FORMAT -f $OUTPUT_FILE -b $BATCH_SIZE --sort-by $SORT_BY --min-blocks $MIN_BLOCKS $EXTRA_ARGS"

if [ -n "$END_BLOCK" ]; then
  CMD_ARGS="$CMD_ARGS -e $END_BLOCK"
fi
if [ "$INCLUDE_EMPTY" = "true" ]; then
  CMD_ARGS="$CMD_ARGS --include-empty"
fi
if [ "$VERBOSE" = "true" ]; then
  CMD_ARGS="$CMD_ARGS -v"
fi

echo "[run-collector] Starting collection: resolvedStartBlock=$RESOLVED_START_BLOCK endBlock=${END_BLOCK:-LATEST} endpoint=$WS_ENDPOINT format=$OUTPUT_FORMAT file=$OUTPUT_FILE"

set -x
node link-node-names.js -n nodes.txt -r $WS_ENDPOINT
if [ "1" = "1" ]; then
  CMD_ARGS="$CMD_ARGS --role node-validator-map.json"
fi

node collect.js $CMD_ARGS
STATUS=$?
set +x

# Write metadata
{
  echo "timestamp_utc=$TIMESTAMP";
  echo "ws_endpoint=$WS_ENDPOINT";
  echo "start_block=$RESOLVED_START_BLOCK";
  echo "end_block=${END_BLOCK:-latest}";
  echo "output_file=$OUTPUT_FILE";
  echo "format=$OUTPUT_FORMAT";
  echo "batch_size=$BATCH_SIZE";
  echo "sort_by=$SORT_BY";
  echo "min_blocks=$MIN_BLOCKS";
  echo "include_empty=$INCLUDE_EMPTY";
  echo "status=$STATUS";
} > "$META_FILE"

echo "[run-collector] Done. Output file: $OUTPUT_FILE (metadata: $META_FILE)"
exit $STATUS
