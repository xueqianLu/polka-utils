# Polkadot Time Structure

Era, Session, Epoch, Slot, Block height — these are key concepts in Polkadot's hierarchical time system.

## Hierarchical Time Layers

Polkadot defines a layered time hierarchy:

```
Era
├── Session × 6
    ├── Epoch × 1  (Session = Epoch in current design)
        ├── Slot × 2400
            ├── Block × 0 or 1
```

## Layer Details

### 1. Slot – The smallest scheduling unit
- Duration: ~6 seconds
- Purpose: Each slot may (or may not) produce exactly one block
- Mechanism: BABE consensus assigns one or more validators to a slot probabilistically
- Relationship: 1 slot ≈ 0–1 blocks (some slots produce no block)

### 2. Epoch
- Duration: ~4 hours
- Composition: 2,400 slots
- Purpose: Fundamental scheduling period in BABE; at the epoch start validators know in which slots they are eligible to author blocks

### 3. Session
- Duration: ~4 hours (currently equal to Epoch)
- Relationship: Session = Epoch
- Purpose: Interval at which the active validator set may update

### 4. Era – Reward / Staking accounting period
- Duration: ~24 hours
- Composition: 6 Sessions / Epochs
- Total Slots: 14,400 (2,400 × 6)
- Purpose: Primary unit for staking reward distribution

## Why Are Validator Rewards Queried Per Era?

### 1. Reward Settlement
- Rewards are calculated and settled once per Era
- Era Points determine proportional reward distribution
- Final allocation is only known after the Era ends

### 2. Accumulation of Era Points
Validators earn Era Points for activities such as:
- Block production
- Parachain validation
- Other consensus-related duties

### 3. Data Completeness
- A single block or slot cannot reflect full validator performance
- Aggregated Era-level data captures a meaningful performance summary

## Practical Numbers (Polkadot Mainnet Example)
```
1 Era = 24 hours
├── 6 Sessions = 6 × 4h
    ├── 6 Epochs = 6 × 4h
        ├── 14,400 Slots = 14,400 × 6s ≈ 24h
            ├── ~14,400 Blocks (ideal case: 1 block per slot)
```

## Why Not Query by Block Height for Rewards?
1. Rewards are not assigned per block; they are Era-based.
2. Per-block data is too granular and incomplete for reward logic.
3. Accurate reward calculation requires aggregating all activity over an Era.

---
*Note:* Some implementation details (e.g. exact epoch/session equivalence or slot timing) may evolve with protocol upgrades. Always consult the latest Polkadot specifications or runtime documentation for precise values.
