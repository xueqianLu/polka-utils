# polka-utils
utils for polka chain.

# install
nvm and node v20

# how to use
sendtx.js
```
    用途：按指定速率发送交易到 Substrate 链（balances.transfer 示例）
    参数（示例使用 yargs）:
        --ws           WebSocket RPC 地址（默认：ws://127.0.0.1:9944）
        --seed         发起账号的 seed 或 mnemonic（默认：//Alice）
        --to           目标地址（可多次调用脚本或在代码中随机生成）
        --amount       转账数量（单位为链本位，例如 Planck）（默认：1000000000000）
        --tps          每秒发送交易数（默认：1）
        --duration     发送总时长（秒），或与 --totalTxs 二选一 
        --totalTxs     发送总交易数（与 --duration 二选一）
        --concurrency 并行签名/发送的上限（默认：100） 
        --nonceAuto    是否自动读取并保持 nonce（true/false，默认 true）
    示例： 
        node sendtx.js --ws ws://127.0.0.1:9944 --seed "//Alice" --to "<dest>" --tps 10 --duration 60
```