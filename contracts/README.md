# Griddle contracts

Foundry project for the two Griddle onchain components:

- **`GriddlePremium`** — $5 crypto unlock (permit + burn in one tx) and $6 fiat unlock (escrow-then-burn with a 30-day dispute window).
- **`GriddleRewards`** — streak milestone rewards, redeemed via EIP-712 signed vouchers issued by the backend.

Both contracts target Base mainnet (chain id 8453) and settle in the Clanker v4 `$WORD` token at `0x304e649e69979298BD1AEE63e175ADf07885fb4b`.

## Layout

```
contracts/
├── src/
│   ├── GriddlePremium.sol
│   ├── GriddleRewards.sol
│   └── interfaces/
│       ├── IWordToken.sol
│       └── IWordOracle.sol
├── test/
│   ├── GriddlePremium.t.sol
│   ├── GriddleRewards.t.sol
│   └── mocks/
│       ├── MockWord.sol
│       └── MockOracle.sol
├── script/
│   └── Deploy.s.sol
└── foundry.toml
```

## Build + test

```bash
forge build
forge test
```

All 27 tests should pass (18 for Premium, 9 for Rewards).

## Deploy

Set the following env vars in a `.env` file (or export them):

```env
PRIVATE_KEY=0x...
BASE_RPC_URL=https://base-mainnet...
BASESCAN_API_KEY=...
ORACLE_ADDRESS=0x...                 # LHAW oracle extended with getWordUsdPrice()
ESCROW_MANAGER_ADDRESS=0x...         # backend EOA that opens fiat escrows
REWARD_SIGNER_ADDRESS=0x...          # address that signs streak claim vouchers
# Optional:
OWNER=0x...                          # defaults to deployer if omitted
WORD_ADDRESS=0x304e649e...           # defaults to mainnet; deploy script
                                     # refuses chain 8453 + non-canonical
```

Then:

```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
```

The script prints both deployed addresses; copy them into `web/.env`:

```env
NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS=0x...
NEXT_PUBLIC_GRIDDLE_REWARDS_ADDRESS=0x...
```

## Deploy the PushedWordOracle (oracle migration)

The original `WordOracle.sol` proxies LHAW's `JackpotManagerV3.clanktonMarketCapUsd`, which depends on LHAW's cron being up. `PushedWordOracle.sol` replaces that with a feed we control — our own 2-min Vercel cron writes the price. See the contract docblock for the full rationale.

### 1. Deploy the new oracle

One-liner via `forge create`, since the constructor only takes an updater EOA address:

```bash
source .env

forge create src/PushedWordOracle.sol:PushedWordOracle \
  --rpc-url base \
  --private-key "$PRIVATE_KEY" \
  --constructor-args 0x6B7c29665F120ca4f5a3C5551eFD503A88a8072F \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

(The `0x6B7c…` address above is the one generated for production. Pass a different address if deploying to a different environment.)

### 2. Fund the updater EOA

Send ~0.0005 Base ETH (≈ $1) to the updater address so it can pay gas for ~720 daily `setPrice` txs at Base gas prices. Refill from the admin UI's "Updater EOA" row whenever the balance drops.

### 3. Wire it into the app

Set the following in Vercel env (Production + Preview):

```
WORD_ORACLE_ADDRESS=<deployed address from step 1>
ORACLE_UPDATER_PRIVATE_KEY=<0x + 64 hex chars, matching the address from step 1>
CRON_SECRET=<random 32-byte hex; Vercel cron sends this as Bearer>
BASE_RPC_URL=<same as used for contracts/.env>
```

### 4. Point GriddlePremium at the new oracle

One `setOracle` call from the owner wallet, then the existing `unlockWithUsdc` path reads from the new feed on the next call:

```bash
cast send "$GRIDDLE_PREMIUM_ADDRESS" \
  "setOracle(address)" \
  "$WORD_ORACLE_ADDRESS" \
  --rpc-url base \
  --private-key "$PRIVATE_KEY"
```

### 5. Verify

Open `/admin` → **Oracle** tab. Status card should show the contract address, updater balance, and a "never set" price. Click **Force update now** — within 5 seconds the card should flip to a live price + "0s ago" staleness. Leave `Cron enabled` on; Vercel's schedule will keep pushing every 2 min.

## Design notes

### Why escrow-then-burn on the fiat path

Fiat payments can be disputed via chargeback for up to ~30 days after the charge clears. Burning tokens is irreversible, so if we burned the swapped `$WORD` immediately and then the player initiated a chargeback, we’d be eating the loss with no recourse. The escrow holds those tokens in the contract for the dispute window — during that window the owner can refund them back to the backend wallet to settle the USD refund cleanly. After the window expires anyone (including the player) can call `burnEscrowed` to finalize.

### Why signed vouchers for rewards instead of a merkle drop

Streak milestones trigger on a per-player event (the solve that completes their 7th consecutive day). Regenerating a merkle root and publishing it after every solve across all active players is massively wasteful compared to having the backend sign a single voucher on the spot. Vouchers also mean the contract doesn’t need to know about the milestone schedule — all of the reward logic lives in the backend signer. Nonces are per-user (not global) so replay protection doesn’t require a global counter or inter-transaction coordination.

### $WORD reference is immutable, not constant

Tests need to swap in a mock `$WORD` to exercise the permit + burn flow. `immutable` gives the same post-deploy guarantee as `constant` (the reference cannot be changed after construction) but lets the deploy script inject the address at construction. The deploy script hardcodes the mainnet address and refuses to deploy on chain 8453 with anything else.
