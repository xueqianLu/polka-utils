#!/bin/sh
set -e
WS_ENDPOINT=${WS_ENDPOINT:-ws://node1:9944}
SEED=${SEED:-//Alice}
: "${TO:?Environment variable TO (destination address) must be set}" || exit 1
TPS=${TPS:-1}
DURATION=${DURATION:-3600}
AMOUNT=${AMOUNT:-1000000000000}
CONCURRENCY=${CONCURRENCY:-100}
NONCE_AUTO=${NONCE_AUTO:-true}
WAIT_SECONDS=${WAIT_SECONDS:-0} # Optional extra wait before start
READY_RETRIES=${READY_RETRIES:-20}
READY_INTERVAL=${READY_INTERVAL:-5}
EXTRA_ARGS=${EXTRA_ARGS:-}

wait_for_ready() {
  i=0
  while [ $i -lt $READY_RETRIES ]; do
    # Use a tiny node snippet to try connecting; if success exit 0
    if node -e "(async()=>{const { WsProvider } = await import('@polkadot/api');const p=new WsProvider('${WS_ENDPOINT}');try{await p.connect();}catch(e){}try{p.disconnect();}catch(e){}console.log('ok');})().catch(()=>process.exit(1));" >/dev/null 2>&1; then
      return 0
    fi
    echo "[run-sendtx] Waiting for node RPC at $WS_ENDPOINT (attempt $((i+1))/$READY_RETRIES)"
    i=$((i+1))
    sleep $READY_INTERVAL
  done
  echo "[run-sendtx] Node not ready after $READY_RETRIES attempts, proceeding anyway..."
}

if [ "$WAIT_SECONDS" -gt 0 ]; then
  echo "[run-sendtx] Initial sleep $WAIT_SECONDS s"
  sleep "$WAIT_SECONDS"
fi

wait_for_ready || true

echo "[run-sendtx] Starting sendtx with ws=$WS_ENDPOINT seed=$SEED to=$TO tps=$TPS duration=$DURATION amount=$AMOUNT concurrency=$CONCURRENCY nonceAuto=$NONCE_AUTO"
exec node sendtx.js --ws "$WS_ENDPOINT" --seed "$SEED" --to "$TO" --tps "$TPS" --duration "$DURATION" --amount "$AMOUNT" --concurrency "$CONCURRENCY" --nonceAuto "$NONCE_AUTO" $EXTRA_ARGS
