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

## Design notes

### Why escrow-then-burn on the fiat path

Fiat payments can be disputed via chargeback for up to ~30 days after the charge clears. Burning tokens is irreversible, so if we burned the swapped `$WORD` immediately and then the player initiated a chargeback, we’d be eating the loss with no recourse. The escrow holds those tokens in the contract for the dispute window — during that window the owner can refund them back to the backend wallet to settle the USD refund cleanly. After the window expires anyone (including the player) can call `burnEscrowed` to finalize.

### Why signed vouchers for rewards instead of a merkle drop

Streak milestones trigger on a per-player event (the solve that completes their 7th consecutive day). Regenerating a merkle root and publishing it after every solve across all active players is massively wasteful compared to having the backend sign a single voucher on the spot. Vouchers also mean the contract doesn’t need to know about the milestone schedule — all of the reward logic lives in the backend signer. Nonces are per-user (not global) so replay protection doesn’t require a global counter or inter-transaction coordination.

### $WORD reference is immutable, not constant

Tests need to swap in a mock `$WORD` to exercise the permit + burn flow. `immutable` gives the same post-deploy guarantee as `constant` (the reference cannot be changed after construction) but lets the deploy script inject the address at construction. The deploy script hardcodes the mainnet address and refuses to deploy on chain 8453 with anything else.
