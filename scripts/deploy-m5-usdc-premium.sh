#!/usr/bin/env bash
#
# End-to-end deploy runbook for M5-usdc-premium (PR #82).
#
# What it does:
#   1. Regenerates the swap recipe (commands + inputs bytes) against
#      live Base mainnet pool state via Uniswap's SDK.
#   2. Deploys a fresh GriddlePremium + WordOracle to Base mainnet.
#   3. Calls setSwapConfig() on the new contract with the recipe.
#   4. Approves WORD.allowance(new_premium) from the escrow EOA.
#   5. Runs the premium-payment-telemetry DB migration on Neon.
#   6. Prints the Vercel env vars you need to add.
#
# Your keys never leave your shell. The script reads them from env
# and feeds them directly into forge/cast — nothing gets printed to
# stdout, written to disk, or committed to git.
#
# ──────────────────────────────────────────────────────────────────
# Prerequisites (env vars):
#
#   PRIVATE_KEY                    — deployer key (becomes owner)
#   BASE_RPC_URL                   — Alchemy / Coinbase Base RPC
#   BASESCAN_API_KEY               — for --verify
#   ESCROW_MANAGER_ADDRESS         — 0x2097...9080 (public)
#   ESCROW_MANAGER_PRIVATE_KEY     — key for that address
#   DATABASE_URL_UNPOOLED          — Neon prod (direct connection, not pooler)
#
# Optional:
#   OWNER                          — defaults to deployer
#   JACKPOT_MANAGER_ADDRESS        — defaults to 0xfcb0...edB5 (LHAW on Base)
#
# Load options (in order of preference):
#   a) Pre-export vars in your shell, then run:
#        bash scripts/deploy-m5-usdc-premium.sh
#   b) Pass an env file — the script parses it with `bun`, NOT shell
#      `source`, so values containing '&', '|', '$', etc. work fine
#      without quoting:
#        bash scripts/deploy-m5-usdc-premium.sh --env-file .env.local
#   c) `.env.local` in the repo root is auto-loaded if it exists and
#      no --env-file is given.
#
# ──────────────────────────────────────────────────────────────────

set -euo pipefail

# ──────────────── helpers ────────────────
color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
step()  { color "1;34" "→ $1"; }
ok()    { color "1;32" "✓ $1"; }
warn()  { color "1;33" "! $1"; }
fatal() { color "1;31" "✗ $1"; exit 1; }

confirm() {
  read -p "$(color "1;33" "$1 [y/N] ")" r
  [[ "$r" == "y" || "$r" == "Y" ]] || fatal "aborted"
}

require_env() {
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      fatal "missing env var: $v"
    fi
  done
}

# ──────────────── arg parsing ────────────────
ENV_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --help|-h)
      sed -n '1,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | head -n -1
      exit 0
      ;;
    *)
      fatal "unknown arg: $1"
      ;;
  esac
done

# ──────────────── preflight ────────────────
step "Preflight"

for cmd in forge cast jq bun psql; do
  command -v "$cmd" >/dev/null || fatal "missing CLI: $cmd"
done

# Repo root — resolves whether script runs from root or scripts/.
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO"

# Default: auto-load ./.env.local if it exists and no --env-file passed.
if [ -z "$ENV_FILE" ] && [ -f .env.local ]; then
  ENV_FILE=".env.local"
fi

# Safe env loader: parse the file via bun (NOT shell `source`) so
# values containing '&', '|', '$', '#', quotes, etc. load cleanly.
# Uses Bun.file + manual line parsing — same semantics as dotenv.
if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || fatal "env file not found: $ENV_FILE"
  while IFS='=' read -r key; do
    # `key` is the full line "KEY=val"; re-split on the first '='
    :
  done <<<""
  # Export each KEY=VALUE pair. bun emits null-terminated
  # "key\0value\0" so we don't need to escape shell metachars.
  while IFS= read -r -d '' key && IFS= read -r -d '' value; do
    export "$key=$value"
  done < <(
    bun --silent -e '
      import { readFileSync } from "node:fs";
      const f = process.argv[1];
      const txt = readFileSync(f, "utf8");
      for (const raw of txt.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, "");
        if (!line || line.startsWith("#")) continue;
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith(`"`) && v.endsWith(`"`)) || (v.startsWith(`'`) && v.endsWith(`'`))) {
          v = v.slice(1, -1);
        }
        // null-delimited key then value
        process.stdout.write(m[1] + "\0" + v + "\0");
      }
    ' "$ENV_FILE"
  )
  ok "loaded env from $ENV_FILE"
fi

require_env PRIVATE_KEY BASE_RPC_URL BASESCAN_API_KEY \
            ESCROW_MANAGER_ADDRESS ESCROW_MANAGER_PRIVATE_KEY \
            DATABASE_URL_UNPOOLED

# Confirm we're on a branch that has the fork-test artifacts.
if [ ! -f scripts/swap-recipe/compute-recipe.ts ]; then
  fatal "scripts/swap-recipe/compute-recipe.ts missing — check out M5-usdc-premium-fork-test"
fi

WORD_ADDR="0x304e649e69979298BD1AEE63e175ADf07885fb4b"
MAX_UINT256="115792089237316195423570985008687907853269984665640564039457584007913129639935"

ok "env + CLIs present"

# ──────────────── step 1: recipe ────────────────
step "Generating swap recipe from live Base pool state"
( cd scripts/swap-recipe && bun install --silent )
RECIPE=$(cd scripts/swap-recipe && bun run compute-recipe.ts --json)

COMMANDS=$(echo "$RECIPE" | jq -r '.commands')
# cast accepts bytes[] as a bracketed array literal; jq -c gives compact JSON.
INPUTS=$(echo "$RECIPE" | jq -c '.inputs')
MIN_OUT=$(echo "$RECIPE" | jq -r '.minWordOut')
N_INPUTS=$(echo "$RECIPE" | jq '.inputs | length')

ok "recipe: commands=$COMMANDS, ${N_INPUTS} inputs, minWordOut≈${MIN_OUT} WORD wei"

# ──────────────── step 2: deploy ────────────────
step "Deploying GriddlePremium + WordOracle to Base mainnet"
confirm "Ready to broadcast to Base mainnet? Gas costs ~0.005 ETH."

(
  cd contracts
  export PRIVATE_KEY BASE_RPC_URL BASESCAN_API_KEY \
         ESCROW_MANAGER_ADDRESS JACKPOT_MANAGER_ADDRESS \
         OWNER
  forge script script/Deploy.s.sol \
    --rpc-url "$BASE_RPC_URL" \
    --broadcast \
    --verify \
    --etherscan-api-key "$BASESCAN_API_KEY" \
    -vv
)

BROADCAST_FILE="$REPO/contracts/broadcast/Deploy.s.sol/8453/run-latest.json"
[ -f "$BROADCAST_FILE" ] || fatal "broadcast file not found: $BROADCAST_FILE"

NEW_PREMIUM=$(jq -r '.transactions[] | select(.contractName=="GriddlePremium") | .contractAddress' "$BROADCAST_FILE")
NEW_ORACLE=$(jq -r  '.transactions[] | select(.contractName=="WordOracle")     | .contractAddress' "$BROADCAST_FILE")

[ -n "$NEW_PREMIUM" ] && [ "$NEW_PREMIUM" != "null" ] || fatal "failed to parse GriddlePremium address"
[ -n "$NEW_ORACLE"  ] && [ "$NEW_ORACLE"  != "null" ] || fatal "failed to parse WordOracle address"

ok "GriddlePremium: $NEW_PREMIUM"
ok "WordOracle:     $NEW_ORACLE"

# ──────────────── step 3: setSwapConfig ────────────────
step "Setting swap recipe on new GriddlePremium (owner tx)"
cast send "$NEW_PREMIUM" "setSwapConfig(bytes,bytes[])" \
  "$COMMANDS" "$INPUTS" \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --confirmations 1 >/dev/null
ok "setSwapConfig committed"

# ──────────────── step 4: escrow approve ────────────────
step "Approving WORD allowance from escrow EOA"
CURRENT_ALLOWANCE=$(cast call "$WORD_ADDR" "allowance(address,address)(uint256)" \
  "$ESCROW_MANAGER_ADDRESS" "$NEW_PREMIUM" --rpc-url "$BASE_RPC_URL")

if [ "$CURRENT_ALLOWANCE" != "$MAX_UINT256" ]; then
  cast send "$WORD_ADDR" "approve(address,uint256)(bool)" \
    "$NEW_PREMIUM" "$MAX_UINT256" \
    --rpc-url "$BASE_RPC_URL" \
    --private-key "$ESCROW_MANAGER_PRIVATE_KEY" \
    --confirmations 1 >/dev/null
  ok "WORD.approve committed (escrow EOA → new GriddlePremium, MAX)"
else
  ok "allowance already MAX — skipping"
fi

ESCROW_BALANCE=$(cast call "$WORD_ADDR" "balanceOf(address)(uint256)" \
  "$ESCROW_MANAGER_ADDRESS" --rpc-url "$BASE_RPC_URL")
ok "escrow EOA holds: $ESCROW_BALANCE WORD wei"

# ──────────────── step 5: DB migration ────────────────
step "Running DB migration 0019 on Neon"
confirm "This runs DDL on prod Neon. Proceed?"
psql "$DATABASE_URL_UNPOOLED" -f drizzle/0019_premium_payment_telemetry.sql
ok "migration applied (idempotent — ADD COLUMN IF NOT EXISTS)"

# ──────────────── summary ────────────────
echo ""
color "1;32" "═══════════════════════════════════════════════════════"
color "1;32" "              DEPLOY COMPLETE"
color "1;32" "═══════════════════════════════════════════════════════"
echo ""
color "1;34" "Add to Vercel (Production + Preview):"
cat <<EOF
  NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS = $NEW_PREMIUM
  NEXT_PUBLIC_USDC_ADDRESS            = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  BASE_RPC_URL                        = <your Alchemy URL, server-only>
  CRON_SECRET                         = <long random string — for the sync-escrow-burns cron>

Confirm these already exist in Vercel:
  ESCROW_MANAGER_PRIVATE_KEY
  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID
EOF

echo ""
color "1;34" "Then:"
cat <<EOF
  1. Merge the fork-test branch (or cherry-pick scripts/swap-recipe
     onto main) so the TS script + fork test land on main.
  2. Vercel auto-deploys the webapp from main (existing pipeline).
  3. Smoke-test:
       - Crypto: connect a wallet with \$5+ USDC, hit the premium gate
       - Fiat:   stripe trigger checkout.session.completed \\
                   --add checkout_session:metadata.wallet=0x... \\
                   --add checkout_session:metadata.sessionId=deadbeef...
  4. Watch admin → Operations → Transactions for both rows appearing
     with correct amounts and escrow-status pills.
EOF

echo ""
color "1;32" "Done."
