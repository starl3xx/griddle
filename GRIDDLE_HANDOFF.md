# Griddle — Full Build Handoff

## What is Griddle?

Griddle is a daily word puzzle game at **griddle.fun**. Players are presented with a 3×3 grid of letters and must find the single hidden 9-letter word that uses every cell exactly once, subject to a non-adjacency constraint: consecutive letters in the word cannot occupy adjacent cells in the grid (up/down/left/right only, no diagonals).

It is a standalone web app (Next.js) that also runs natively as a Farcaster mini app and Base App mini app. Wallet connection is optional — anyone can play free, but connecting a wallet and burning $5 in $WORD unlocks premium features permanently.

---

## Core Game Mechanic

### The Grid

```
Position indices:
0 | 1 | 2
---------
3 | 4 | 5
---------
6 | 7 | 8
```

### Adjacency Rules (orthogonal only, no diagonals)

| Cell | Adjacent to |
|------|-------------|
| 0 | 1, 3 |
| 1 | 0, 2, 4 |
| 2 | 1, 5 |
| 3 | 0, 4, 6 |
| 4 | 1, 3, 5, 7 |
| 5 | 2, 4, 8 |
| 6 | 3, 7 |
| 7 | 4, 6, 8 |
| 8 | 5, 7 |

### The Constraint

When building a word, each consecutive letter pair must occupy **non-adjacent** grid cells. Each cell may only be used **once** per word.

### The Perfect Word

Every puzzle has exactly one valid 9-letter answer that uses all cells exactly once. This is the only solution that wins the jackpot. Shorter valid English words can still be found and scored.

### Proven Mathematical Properties

- Every 9-letter word with 9 unique letters has exactly **12,072 valid grid arrangements**
- The puzzle bank (279 curated words) generates millions of unique daily puzzles
- The same word can be reused with a different grid after a minimum 180-day gap

---

## Tech Stack

```
Framework:        Next.js 14 (App Router)
Language:         TypeScript
Styling:          Tailwind CSS
Database:         PostgreSQL + Drizzle ORM
Blockchain:       Base L2
Token:            $WORD (ERC-20, Clanker v4)
                  0x304e649e69979298BD1AEE63e175ADf07885fb4b
Wallet:           wagmi + viem + RainbowKit (web)
                  @farcaster/frame-sdk (Farcaster mini app)
                  @coinbase/wallet-sdk (Base App mini app)
OG Images:        @vercel/og (Satori)
Hosting:          Vercel
Domain:           griddle.fun
```

---

## Puzzle Data

### Word List (279 curated words)

Each entry: `{ word, grid, tier }`

- `grid` — 9-character string, grid[i] is the letter at position i
- `tier` — A (very common), B (common), C (usable), P (promoted/memorable)

```json
[{"word":"education","grid":"ecduotian","tier":"A"},{"word":"companies","grid":"cpomenias","tier":"A"},{"word":"countries","grid":"cnouerits","tier":"A"},{"word":"wonderful","grid":"wdonurfel","tier":"A"},{"word":"dangerous","grid":"dganuroes","tier":"A"},{"word":"boyfriend","grid":"bfoynierd","tier":"A"},{"word":"champions","grid":"cmhaniops","tier":"A"},{"word":"universal","grid":"uvniarsel","tier":"A"},{"word":"discovery","grid":"dcisrveoy","tier":"A"},{"word":"introduce","grid":"irntcduoe","tier":"A"},{"word":"chemistry","grid":"cmherstiy","tier":"A"},{"word":"computers","grid":"cpomrteus","tier":"A"},{"word":"franchise","grid":"fnrashice","tier":"B"},{"word":"breathing","grid":"barenhitg","tier":"B"},{"word":"daughters","grid":"dgaurtehs","tier":"B"},{"word":"traveling","grid":"tvranlieg","tier":"B"},{"word":"inspector","grid":"ipnsocter","tier":"B"},{"word":"signature","grid":"snigrtuae","tier":"B"},{"word":"copyright","grid":"cyophigrt","tier":"B"},{"word":"neighbors","grid":"ngeirbohs","tier":"B"},{"word":"reactions","grid":"rceaniots","tier":"B"},{"word":"nightmare","grid":"nhigrmate","tier":"B"},{"word":"overnight","grid":"orvehignt","tier":"B"},{"word":"platforms","grid":"ptlamorfs","tier":"B"},{"word":"wrestling","grid":"wsrenlitg","tier":"B"},{"word":"publisher","grid":"plubeshir","tier":"B"},{"word":"breakdown","grid":"barewdokn","tier":"B"},{"word":"particles","grid":"ptareclis","tier":"B"},{"word":"exploring","grid":"elxpnriog","tier":"B"},{"word":"workplace","grid":"wkorclape","tier":"B"},{"word":"provinces","grid":"pvroencis","tier":"B"},{"word":"algorithm","grid":"aolghitrm","tier":"B"},{"word":"favorites","grid":"foaveitrs","tier":"B"},{"word":"machinery","grid":"mhacrneiy","tier":"B"},{"word":"voluntary","grid":"vuolrtany","tier":"B"},{"word":"magnitude","grid":"mnagdtuie","tier":"B"},{"word":"sexuality","grid":"suextliay","tier":"B"},{"word":"factories","grid":"ftacerios","tier":"B"},{"word":"fashioned","grid":"fhaseonid","tier":"B"},{"word":"biography","grid":"bgiohapry","tier":"B"},{"word":"specialty","grid":"scpetaliy","tier":"B"},{"word":"merchants","grid":"mcertanhs","tier":"B"},{"word":"livestock","grid":"leivctosk","tier":"B"},{"word":"oversight","grid":"orvehigst","tier":"B"},{"word":"comprised","grid":"cpomeisrd","tier":"B"},{"word":"educators","grid":"ecdurtoas","tier":"B"},{"word":"fragments","grid":"fgratenms","tier":"B"},{"word":"submarine","grid":"smubnriae","tier":"B"},{"word":"microwave","grid":"mricvwaoe","tier":"B"},{"word":"righteous","grid":"rhigueots","tier":"B"},{"word":"constable","grid":"csonlabte","tier":"P"},{"word":"equations","grid":"eaquniots","tier":"B"},{"word":"teachings","grid":"tceaginhs","tier":"B"},{"word":"policeman","grid":"piolaemcn","tier":"B"},{"word":"hydraulic","grid":"hrydiulac","tier":"B"},{"word":"adjusting","grid":"audjntisg","tier":"B"},{"word":"diplomacy","grid":"dlipcmaoy","tier":"B"},{"word":"masculine","grid":"mcasnliue","tier":"B"},{"word":"boulevard","grid":"blourvaed","tier":"B"},{"word":"intervals","grid":"ientlvars","tier":"C"},{"word":"preaching","grid":"parenhicg","tier":"C"},{"word":"exclusion","grid":"elxcosiun","tier":"C"},{"word":"skeptical","grid":"spkeaictl","tier":"C"},{"word":"embracing","grid":"ermbnciag","tier":"C"},{"word":"strangely","grid":"satrlgeny","tier":"C"},{"word":"furnished","grid":"fnureshid","tier":"C"},{"word":"manifesto","grid":"miantesfo","tier":"P"},{"word":"monastery","grid":"maonrtesy","tier":"C"},{"word":"nightclub","grid":"nhigucltb","tier":"P"},{"word":"numerical","grid":"neumaicrl","tier":"C"},{"word":"supremacy","grid":"srupcmaey","tier":"C"},{"word":"bothering","grid":"bhotnrieg","tier":"C"},{"word":"consulted","grid":"csoneltud","tier":"C"},{"word":"metabolic","grid":"maetiolbc","tier":"C"},{"word":"simulator","grid":"suimoatlr","tier":"C"},{"word":"terminals","grid":"tmerlnais","tier":"C"},{"word":"benchmark","grid":"bcenrmahk","tier":"P"},{"word":"duplicate","grid":"dluptcaie","tier":"C"},{"word":"columnist","grid":"cuolsnimt","tier":"C"},{"word":"educating","grid":"ecduntiag","tier":"C"},{"word":"consulate","grid":"csontlaue","tier":"C"},{"word":"departing","grid":"daepntirg","tier":"C"},{"word":"lucrative","grid":"lrucvtiae","tier":"C"},{"word":"porcelain","grid":"pcorilaen","tier":"C"},{"word":"sparkling","grid":"srpanlikg","tier":"C"},{"word":"longevity","grid":"lgontviey","tier":"C"},{"word":"creations","grid":"careniots","tier":"C"},{"word":"customary","grid":"ctusrmaoy","tier":"C"},{"word":"diplomats","grid":"dliptmaos","tier":"C"},{"word":"exploding","grid":"elxpndiog","tier":"C"},{"word":"flowering","grid":"fwlonrieg","tier":"C"},{"word":"marvelous","grid":"mvaruloes","tier":"C"},{"word":"coastline","grid":"csoanlite","tier":"P"},{"word":"judgments","grid":"jgudtenms","tier":"C"},{"word":"resolving","grid":"roesnvilg","tier":"C"},{"word":"syndicate","grid":"sdyntcaie","tier":"C"},{"word":"obligated","grid":"oibleatgd","tier":"C"},{"word":"pulmonary","grid":"pmulrnaoy","tier":"C"},{"word":"troubling","grid":"turonlibg","tier":"C"},{"word":"comedians","grid":"ceomniads","tier":"C"},{"word":"fisherman","grid":"fhisarmen","tier":"C"},{"word":"simulated","grid":"suimeatld","tier":"C"},{"word":"birthdays","grid":"btirydahs","tier":"C"},{"word":"blueprint","grid":"belunript","tier":"P"},{"word":"complains","grid":"cpomnails","tier":"C"},{"word":"cylinders","grid":"ciylrdens","tier":"C"},{"word":"nostalgic","grid":"ntosilgac","tier":"C"},{"word":"scrambled","grid":"sacreblmd","tier":"C"},{"word":"godfather","grid":"gfodethar","tier":"P"},{"word":"royalties","grid":"raoyetils","tier":"C"},{"word":"sectional","grid":"stecaonil","tier":"C"},{"word":"compliant","grid":"cpomnialt","tier":"C"},{"word":"farmhouse","grid":"fmarsouhe","tier":"P"},{"word":"proactive","grid":"parovtice","tier":"C"},{"word":"dominates","grid":"diomeatns","tier":"C"},{"word":"hypocrite","grid":"hoyptrice","tier":"P"},{"word":"horseback","grid":"hsorcbaek","tier":"P"},{"word":"misplaced","grid":"mpiseacld","tier":"C"},{"word":"spherical","grid":"sephaicrl","tier":"C"},{"word":"adversity","grid":"aedvtsiry","tier":"C"},{"word":"authorize","grid":"ahutzrioe","tier":"C"},{"word":"downright","grid":"dnowhigrt","tier":"C"},{"word":"insulated","grid":"iunseatld","tier":"C"},{"word":"keyboards","grid":"kbeydaros","tier":"C"},{"word":"faculties","grid":"fuacetils","tier":"C"},{"word":"sunflower","grid":"sfuneowlr","tier":"P"},{"word":"vineyards","grid":"veindarys","tier":"C"},{"word":"davenport","grid":"deavrpont","tier":"C"},{"word":"fostering","grid":"ftosnrieg","tier":"C"},{"word":"outbreaks","grid":"obutkears","tier":"C"},{"word":"stumbling","grid":"smtunlibg","tier":"C"},{"word":"excursion","grid":"euxcosirn","tier":"C"},{"word":"hairstyle","grid":"hrailtyse","tier":"C"},{"word":"implanted","grid":"ilmpentad","tier":"C"},{"word":"lunchtime","grid":"lcunmtihe","tier":"C"},{"word":"pathogens","grid":"phatngeos","tier":"C"},{"word":"practised","grid":"pcraeistd","tier":"C"},{"word":"fractions","grid":"fcraniots","tier":"C"},{"word":"republics","grid":"ruepclibs","tier":"C"},{"word":"labyrinth","grid":"lyabtinrh","tier":"P"},{"word":"unethical","grid":"utneaichl","tier":"C"},{"word":"polarized","grid":"paoleizrd","tier":"C"},{"word":"construed","grid":"csonerutd","tier":"C"},{"word":"crumbling","grid":"cmrunlibg","tier":"C"},{"word":"doctrines","grid":"dtoceinrs","tier":"C"},{"word":"amplitude","grid":"almpdtuie","tier":"C"},{"word":"customize","grid":"ctuszmioe","tier":"C"},{"word":"formative","grid":"fmorvtiae","tier":"C"},{"word":"nervously","grid":"nverlusoy","tier":"C"},{"word":"trembling","grid":"tmrenlibg","tier":"C"},{"word":"triangles","grid":"tarieglns","tier":"C"},{"word":"youngster","grid":"ynouestgr","tier":"C"},{"word":"gunpowder","grid":"gpunewdor","tier":"P"},{"word":"longitude","grid":"lgondtuie","tier":"C"},{"word":"combating","grid":"cbomntiag","tier":"C"},{"word":"firsthand","grid":"fsirnhatd","tier":"C"},{"word":"modernity","grid":"meodtniry","tier":"C"},{"word":"snowflake","grid":"swnoklafe","tier":"P"},{"word":"throwback","grid":"tohrcbawk","tier":"P"},{"word":"dismantle","grid":"dmislntae","tier":"C"},{"word":"kilograms","grid":"koilmrags","tier":"C"},{"word":"moustache","grid":"msouhacte","tier":"C"},{"word":"sprinkled","grid":"sipreklnd","tier":"C"},{"word":"strangled","grid":"satreglnd","tier":"C"},{"word":"thumbnail","grid":"tmhuinabl","tier":"P"},{"word":"embryonic","grid":"ermbionyc","tier":"C"},{"word":"formulate","grid":"fmortlaue","tier":"C"},{"word":"metaphors","grid":"maetrhops","tier":"C"},{"word":"parchment","grid":"pcarnmeht","tier":"C"},{"word":"dialogues","grid":"dliaeguos","tier":"C"},{"word":"mavericks","grid":"meavkicrs","tier":"C"},{"word":"absurdity","grid":"aubstdiry","tier":"C"},{"word":"complying","grid":"cpomnyilg","tier":"C"},{"word":"goldsmith","grid":"gdoltmish","tier":"C"},{"word":"modernist","grid":"meodsnirt","tier":"C"},{"word":"playhouse","grid":"pylasouhe","tier":"C"},{"word":"craftsmen","grid":"cfraesmtn","tier":"C"},{"word":"launchers","grid":"lnaurhecs","tier":"C"},{"word":"obscurity","grid":"ocbstriuy","tier":"C"},{"word":"onslaught","grid":"olnshugat","tier":"C"},{"word":"bachelors","grid":"bhacrloes","tier":"C"},{"word":"courtship","grid":"crouishtp","tier":"C"},{"word":"sprawling","grid":"saprnliwg","tier":"C"},{"word":"makeshift","grid":"meakfhist","tier":"C"},{"word":"tampering","grid":"tpamnrieg","tier":"C"},{"word":"uniformed","grid":"ufniermod","tier":"C"},{"word":"clergyman","grid":"crleaymgn","tier":"C"},{"word":"eruptions","grid":"epruniots","tier":"C"},{"word":"greyhound","grid":"gyrenouhd","tier":"P"},{"word":"miserably","grid":"meislabry","tier":"C"},{"word":"uncharted","grid":"uhncertad","tier":"C"},{"word":"upholding","grid":"uophndilg","tier":"C"},{"word":"budgetary","grid":"bgudrtaey","tier":"C"},{"word":"embarking","grid":"eambnkirg","tier":"C"},{"word":"foresight","grid":"feorhigst","tier":"C"},{"word":"hamstring","grid":"hsamnritg","tier":"C"},{"word":"contrived","grid":"ctoneivrd","tier":"C"},{"word":"formality","grid":"fmortliay","tier":"C"},{"word":"interplay","grid":"ientaplry","tier":"C"},{"word":"showering","grid":"swhonrieg","tier":"C"},{"word":"backstory","grid":"bkacrtosy","tier":"C"},{"word":"lecturing","grid":"ltecnriug","tier":"C"},{"word":"betraying","grid":"bretnyiag","tier":"C"},{"word":"incubator","grid":"iuncoatbr","tier":"C"},{"word":"supernova","grid":"seupvnora","tier":"P"},{"word":"unmatched","grid":"uanmechtd","tier":"C"},{"word":"custodian","grid":"ctusadion","tier":"C"},{"word":"stockpile","grid":"sctolpike","tier":"C"},{"word":"conspired","grid":"csoneirpd","tier":"C"},{"word":"harmonies","grid":"hmarenios","tier":"C"},{"word":"pneumatic","grid":"puneiatmc","tier":"C"},{"word":"shipwreck","grid":"sphicrewk","tier":"P"},{"word":"custodial","grid":"ctusadiol","tier":"C"},{"word":"macintosh","grid":"miacstonh","tier":"C"},{"word":"normative","grid":"nmorvtiae","tier":"C"},{"word":"patchwork","grid":"pcatrwohk","tier":"P"},{"word":"pseudonym","grid":"puseyondm","tier":"P"},{"word":"anxiously","grid":"ainxlusoy","tier":"C"},{"word":"ligaments","grid":"laigtenms","tier":"C"},{"word":"cautioned","grid":"ctaueonid","tier":"C"},{"word":"organizes","grid":"oargeizns","tier":"C"},{"word":"tribunals","grid":"tbrilnaus","tier":"C"},{"word":"alchemist","grid":"ahlcsmiet","tier":"P"},{"word":"curtailed","grid":"ctureilad","tier":"C"},{"word":"lifeguard","grid":"leifruagd","tier":"C"},{"word":"southward","grid":"stourwahd","tier":"C"},{"word":"cremation","grid":"cmreotian","tier":"C"},{"word":"masterful","grid":"mtasurfel","tier":"C"},{"word":"bacterium","grid":"btacuriem","tier":"C"},{"word":"defiantly","grid":"dieflntay","tier":"C"},{"word":"eastbound","grid":"etasnoubd","tier":"C"},{"word":"lubricant","grid":"lrubncait","tier":"C"},{"word":"observant","grid":"oebsnvart","tier":"C"},{"word":"vehicular","grid":"viehaulcr","tier":"C"},{"word":"auctioned","grid":"atuceonid","tier":"C"},{"word":"backfired","grid":"bkaceirfd","tier":"C"},{"word":"balconies","grid":"bcalenios","tier":"C"},{"word":"bleaching","grid":"balenhicg","tier":"C"},{"word":"emulation","grid":"elmuotian","tier":"C"},{"word":"symbolize","grid":"sbymzlioe","tier":"C"},{"word":"tenacious","grid":"taenuiocs","tier":"C"},{"word":"westbound","grid":"wtesnoubd","tier":"C"},{"word":"byproduct","grid":"brypcduot","tier":"C"},{"word":"configure","grid":"cfonrguie","tier":"C"},{"word":"dragonfly","grid":"dgralnfoy","tier":"P"},{"word":"incurable","grid":"iunclabre","tier":"C"},{"word":"bystander","grid":"btysendar","tier":"C"},{"word":"emigrants","grid":"egmitanrs","tier":"C"},{"word":"outwardly","grid":"owutlrday","tier":"C"},{"word":"sparingly","grid":"srpalngiy","tier":"C"},{"word":"pitchfork","grid":"pcitrfohk","tier":"P"},{"word":"revolting","grid":"roevntilg","tier":"C"},{"word":"sketching","grid":"stkenhicg","tier":"C"},{"word":"fieldwork","grid":"flierwodk","tier":"P"},{"word":"clipboard","grid":"cpliroabd","tier":"P"},{"word":"harlequin","grid":"hlariquen","tier":"P"},{"word":"brimstone","grid":"bmrintose","tier":"P"},{"word":"locksmith","grid":"lkoctmish","tier":"P"},{"word":"wristband","grid":"wsrinbatd","tier":"P"},{"word":"buckwheat","grid":"bkucahewt","tier":"P"},{"word":"scoundrel","grid":"sucoedrnl","tier":"P"},{"word":"cyberpunk","grid":"ceybnpurk","tier":"P"},{"word":"artichoke","grid":"airtkhoce","tier":"P"},{"word":"yardstick","grid":"ydarctisk","tier":"P"},{"word":"quicksand","grid":"qcuinsakd","tier":"P"},{"word":"shakedown","grid":"skhawdoen","tier":"P"},{"word":"afterglow","grid":"aeftoglrw","tier":"P"},{"word":"flowchart","grid":"fwlorhact","tier":"P"},{"word":"decathlon","grid":"daecohltn","tier":"P"},{"word":"goldfinch","grid":"gdolcinfh","tier":"P"},{"word":"awestruck","grid":"aswecrutk","tier":"P"},{"word":"drumstick","grid":"dmructisk","tier":"P"},{"word":"fruitcake","grid":"firukcate","tier":"P"},{"word":"mousetrap","grid":"msouatrep","tier":"P"},{"word":"spearmint","grid":"sapenmirt","tier":"P"},{"word":"trapezoid","grid":"tpraizoed","tier":"P"},{"word":"swordplay","grid":"srwoapldy","tier":"P"},{"word":"juxtapose","grid":"jtuxspoae","tier":"P"},{"word":"tinderbox","grid":"tdinorbex","tier":"P"}]
```

### Puzzle Scheduling Logic

```typescript
// Seeded scheduler — deterministic from puzzle number
function getPuzzleForDay(dayNumber: number, words: PuzzleWord[]): DailyPuzzle {
  // Tier A/B words for first 6 months, then C/P fill in
  // Minimum 180-day gap before any word repeats
  // Each word × 12,072 valid grids = effectively infinite
  // Pick grid index seeded from dayNumber for reproducibility
}
```

Database table:
```sql
CREATE TABLE puzzles (
  id          SERIAL PRIMARY KEY,
  day_number  INT UNIQUE NOT NULL,
  date        DATE UNIQUE NOT NULL,
  word        VARCHAR(9) NOT NULL,
  grid        CHAR(9) NOT NULL,   -- grid[i] = letter at position i
  created_at  TIMESTAMP DEFAULT NOW()
);
```

---

## UI / UX Specification

### Grid Component

The 3×3 grid is the core interactive element. Letter cells have four visual states:

| State | Trigger | Visual |
|-------|---------|--------|
| `open` | Default / valid next move | White bg, full opacity, gold border on hover |
| `current` | Last letter typed | Gold bg, white text, slightly scaled up |
| `used` | Previously used in current word | Light amber bg, amber text, sequence number in corner |
| `blocked` | Adjacent to current cell | Dimmed (opacity ~0.38), X overlay icon |

### Input Model

- Users type on keyboard OR tap/click grid cells directly
- Backspace removes the last letter and restores previous state
- Invalid key (letter not in grid, or blocked cell): grid shakes briefly
- The 9 word slots below the grid fill in as letters are typed
- Real-time feedback: if current partial word is a valid dictionary word (4+ letters), a gold flash badge appears above the grid

### Solve State

When the 9-letter word is found:
- Grid glows / celebrate animation
- Solution word revealed with letter-by-letter reveal
- Share prompt appears immediately
- Jackpot claim CTA if wallet connected

### Premium (Unassisted) Mode

Default: adjacency help shown (blocked cells dimmed with X).
Premium users can toggle help OFF via a settings icon. With help off:
- All cells appear identical regardless of adjacency state
- No sequence numbers on used cells
- Leaderboard entry marked with a special indicator (e.g. ◆ vs ○)

---

## Sharing System

### Share Moment

Triggered immediately on solve (or manually via share button). Three layers:

**1. Plain text (SMS, WhatsApp, any surface)**
```
Griddle #42

A  E  F
T  O  G
L  R  W

Solved in 3:24 ◆ unassisted
griddle.fun
```
The grid always shows the day's actual letters — people who see it can immediately try to solve it mentally. Never reveal the solution word in shares (only after EOD).

**2. Dynamic OG image** (Vercel OG / Satori)

Endpoint: `GET /api/og?puzzle=42&solved=true&time=204&unassisted=true`

Image contents:
- "Griddle #42" header in serif font
- 3×3 grid with letters, gold path drawn through used cells (for solved shares)
- Unsolved shares: just the clean grid, no path
- Solve time + unassisted indicator
- "Can you beat it?" CTA
- griddle.fun URL

This image becomes the link preview on Twitter/X, Discord, iMessage rich previews.

**3. Farcaster cast (when in mini app)**
```typescript
sdk.actions.composeCast({
  text: `Griddle #42\n\nA  E  F\nT  O  G\nL  R  W\n\nSolved in 3:24 ◆`,
  embeds: ['https://griddle.fun/puzzle/42']
})
```
The embed URL renders as a playable Frame — people can tap and play directly from the cast.

**4. Web Share API (mobile browsers)**
```typescript
navigator.share({
  title: 'Griddle #42',
  text: shareText,
  url: 'https://griddle.fun'
})
```
Falls back to clipboard copy with toast on desktop.

### EOD Reveal

The solution word is revealed via the @griddle social account after the puzzle closes (midnight). This is a daily content moment, not an in-app feature. The post shows an animated path through the grid spelling the word.

---

## Wallet & Premium System

### Connect Wallet Flow

A "Connect Wallet" button lives in the top-right of the UI. It is never required to play. Contextual upgrade prompts appear at natural moments:
- On solve: "Connect wallet to claim $WORD and appear on leaderboard"
- On finding a valid shorter word: subtle "Stakers earn $WORD for streaks"
- On leaderboard: anonymous entries shown with CTA

### Premium Unlock

Cost: **$5 in $WORD**, burned permanently. One-time payment, unlocks forever.

**Features unlocked:**
- Solve history (personal archive)
- Play previous puzzles (full archive access)
- Streak protection (1 free per month)
- Stats dashboard (avg time, best solve, heatmaps, unassisted %)
- UI help toggle OFF (skill/status signal, leaderboard indicator)

**UX flow:**
```
User clicks "Unlock Premium"
  → Frontend fetches live $WORD price from oracle
  → Shows: "Burn $5.00 in $WORD · ≈ 15,234 $WORD at current price"
  → User confirms → signs EIP-2612 permit (1 wallet popup, no gas)
  → Single tx: GriddlePremium.unlockWithPermit(amount, deadline, v, r, s)
  → Contract: validates oracle price, calls permit() then burnFrom()
  → isPremium[wallet] = true onchain
  → Frontend reads state and unlocks features
```

Always display dollar amount ($5) prominently. Token amount is secondary.

### GriddlePremium Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IWordToken {
    function permit(address owner, address spender,
        uint256 value, uint256 deadline,
        uint8 v, bytes32 r, bytes32 s) external;
    function burnFrom(address account, uint256 value) external;
}

interface IOracle {
    function getWordUsdPrice() external view returns (uint256 price, uint256 updatedAt);
}

contract GriddlePremium {
    IWordToken public constant WORD =
        IWordToken(0x304e649e69979298BD1AEE63e175ADf07885fb4b);
    IOracle public oracle;

    uint256 public constant UNLOCK_USD   = 5e18;   // $5.00 (18 decimals)
    uint256 public constant SLIPPAGE_PCT = 15;      // ±15% tolerance
    uint256 public constant MAX_ORACLE_AGE = 5 minutes;

    mapping(address => bool) public isPremium;

    event Unlocked(address indexed user, uint256 tokensBurned);

    constructor(address oracle_) { oracle = IOracle(oracle_); }

    function unlockWithPermit(
        uint256 tokenAmount,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        (uint256 price, uint256 updatedAt) = oracle.getWordUsdPrice();
        require(block.timestamp - updatedAt <= MAX_ORACLE_AGE, "stale price");

        uint256 expected = UNLOCK_USD * 1e18 / price;
        uint256 minTokens = expected * (100 - SLIPPAGE_PCT) / 100;
        uint256 maxTokens = expected * (100 + SLIPPAGE_PCT) / 100;
        require(tokenAmount >= minTokens && tokenAmount <= maxTokens, "bad amount");

        WORD.permit(msg.sender, address(this), tokenAmount, deadline, v, r, s);
        WORD.burnFrom(msg.sender, tokenAmount);

        isPremium[msg.sender] = true;
        emit Unlocked(msg.sender, tokenAmount);
    }
}
```

Key properties of $WORD (Clanker v4 ClankerToken):
- Address: `0x304e649e69979298BD1AEE63e175ADf07885fb4b` (Base mainnet)
- 18 decimals, 100B total supply
- Inherits `ERC20Permit` (EIP-2612) ✓ — single-tx burn via permit is supported
- Inherits `ERC20Burnable` ✓ — `burnFrom()` available

### Oracle

Extend the existing LHAW CoinGecko oracle to expose `getWordUsdPrice()`. Same 5-minute update cadence. Same proven infrastructure.

---

## Jackpot System

First wallet-connected player to find the 9-letter word each day wins a small $WORD jackpot. Anonymous solves do not qualify for the jackpot but are still valid solves.

Jackpot structure (TBD final amounts, suggested):
- Daily prize pool seeded from treasury
- Time-based multiplier: reward scales down throughout the day so early solvers earn more
- Onchain claim via smart contract after solve is verified server-side

Retroactive credit: if a player solves anonymously then connects their wallet later that day, they may claim based on their original solve time (captured server-side with timestamp).

---

## Farcaster Mini App Integration

### Frame Manifest

```json
// /.well-known/farcaster.json
{
  "accountAssociation": { ... },
  "frame": {
    "version": "1",
    "name": "Griddle",
    "iconUrl": "https://griddle.fun/icon.png",
    "splashImageUrl": "https://griddle.fun/splash.png",
    "splashBackgroundColor": "#f5ead4",
    "homeUrl": "https://griddle.fun",
    "webhookUrl": "https://griddle.fun/api/farcaster/webhook"
  }
}
```

### SDK Context Detection

```typescript
import { sdk } from '@farcaster/frame-sdk'

async function initApp() {
  const context = await sdk.context
  
  if (context?.client?.clientFid) {
    // Running inside Farcaster mini app
    // Use sdk.wallet.ethProvider for wallet
    // Use sdk.actions.composeCast() for sharing
    // Call sdk.actions.ready() when UI is loaded
    await sdk.actions.ready()
  } else if (window.ethereum?.isCoinbaseWallet) {
    // Running inside Coinbase/Base App
    // Use window.ethereum directly
  } else {
    // Web browser
    // Use RainbowKit / WalletConnect
  }
}
```

### Sharing from Farcaster

```typescript
async function shareToFarcaster(puzzle: DailyPuzzle, result: SolveResult) {
  const gridText = formatGridText(puzzle.grid) // "A  E  F\nT  O  G\nL  R  W"
  const text = `Griddle #${puzzle.dayNumber}\n\n${gridText}\n\n${
    result.solved 
      ? `Solved in ${formatTime(result.timeSeconds)}${result.unassisted ? ' ◆' : ''}`
      : `Best: ${result.bestWord} (${result.bestWord.length} letters)`
  }`
  
  await sdk.actions.composeCast({
    text,
    embeds: [`https://griddle.fun/puzzle/${puzzle.dayNumber}`]
  })
}
```

---

## Database Schema

```sql
-- Daily puzzles (pre-computed, seeded)
CREATE TABLE puzzles (
  id          SERIAL PRIMARY KEY,
  day_number  INT UNIQUE NOT NULL,
  date        DATE UNIQUE NOT NULL,
  word        VARCHAR(9) NOT NULL,
  grid        CHAR(9) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Player solves
CREATE TABLE solves (
  id           SERIAL PRIMARY KEY,
  puzzle_id    INT REFERENCES puzzles(id),
  wallet       VARCHAR(42),          -- null for anonymous
  session_id   VARCHAR(64),          -- anonymous tracking
  solved       BOOLEAN DEFAULT FALSE,
  best_word    VARCHAR(9),
  time_seconds INT,
  unassisted   BOOLEAN DEFAULT FALSE,
  jackpot_claimed BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- Premium status (mirrors onchain, cached for perf)
CREATE TABLE premium_users (
  wallet      VARCHAR(42) PRIMARY KEY,
  unlocked_at TIMESTAMP,
  tx_hash     VARCHAR(66)
);

-- Leaderboard (daily)
CREATE TABLE leaderboard (
  puzzle_id    INT REFERENCES puzzles(id),
  wallet       VARCHAR(42),
  time_seconds INT,
  unassisted   BOOLEAN,
  rank         INT,
  PRIMARY KEY (puzzle_id, wallet)
);
```

---

## API Routes

```
GET  /api/puzzle/today          → today's puzzle (grid, day_number, date) — NO word
GET  /api/puzzle/[dayNumber]    → specific puzzle (premium only for past)
POST /api/solve                 → submit solve attempt, verify server-side
GET  /api/leaderboard/[day]     → daily leaderboard
GET  /api/player/[wallet]       → player stats + history (premium only)
GET  /api/og                    → OG image generation (Vercel OG)
POST /api/premium/verify        → verify onchain premium status, cache in DB
GET  /api/words/validate        → validate if a word is valid on current grid
```

The target word is **never** sent to the client. Solve verification happens server-side: client sends the claimed word, server checks it against today's answer.

---

## Project Structure

```
griddle/
├── app/
│   ├── page.tsx                 # Main game
│   ├── layout.tsx               # Root layout
│   ├── api/
│   │   ├── puzzle/
│   │   │   ├── today/route.ts
│   │   │   └── [day]/route.ts
│   │   ├── solve/route.ts
│   │   ├── leaderboard/route.ts
│   │   ├── og/route.ts          # Vercel OG image
│   │   ├── player/[wallet]/route.ts
│   │   └── farcaster/webhook/route.ts
├── components/
│   ├── Grid.tsx                 # 3×3 grid, cell states, interactions
│   ├── WordSlots.tsx            # 9 letter slots below grid
│   ├── Leaderboard.tsx
│   ├── ShareModal.tsx
│   ├── PremiumModal.tsx         # $5 burn flow
│   └── StatsModal.tsx
├── lib/
│   ├── puzzles.ts               # Puzzle data, scheduler
│   ├── words.ts                 # Word list JSON, validation
│   ├── adjacency.ts             # Grid logic, constraint checking
│   ├── sharing.ts               # Share text generation
│   ├── wallet.ts                # Wallet adapter (web/farcaster/base)
│   └── db/
│       ├── schema.ts
│       └── queries.ts
├── contracts/
│   └── GriddlePremium.sol
├── public/
│   ├── .well-known/
│   │   └── farcaster.json
├── words.json                   # The 279-word puzzle bank (full JSON above)
└── GRIDDLE_HANDOFF.md           # This file
```

---

## Environment Variables

```env
DATABASE_URL=
NEXT_PUBLIC_WORD_TOKEN_ADDRESS=0x304e649e69979298BD1AEE63e175ADf07885fb4b
NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS=   # deploy this contract
NEXT_PUBLIC_CHAIN_ID=8453              # Base mainnet
ORACLE_API_KEY=                        # CoinGecko key (existing from LHAW)
PUZZLE_SEED_SECRET=                    # For deterministic daily puzzle selection
```

---

## Key Design Decisions to Preserve

1. **Target word never sent to client** — all validation server-side
2. **Grid shows actual letters in shares** — people can try to solve from a share
3. **Non-adjacency is the only constraint** — no other rules
4. **Each cell used exactly once** for the 9-letter target (no reuse)
5. **UI help is ON by default** — blocked cells are visually dimmed. Premium users can turn it OFF
6. **Wallet connection never required** — the game must be fully playable anonymously
7. **Plain text share works everywhere** — emoji/unicode grid, no image dependency
8. **$5 flat burn, one-time, forever** — not a subscription, not tiered
9. **OG image always shows letters** — not just a result card, it's a puzzle teaser
10. **Unassisted solves marked separately** on leaderboard — a genuine skill signal

---

## Notes for Claude Code

- Start with the core game logic in `lib/adjacency.ts` and the Grid component — get the mechanic working first
- The word list JSON is complete and includes pre-computed valid grids — no solver needed at runtime
- The adjacency check is pure JS, runs client-side for the UI, and server-side for verification
- The share text formatter is critical to get right early — it drives all virality
- OG image route using `@vercel/og` — render the 3×3 grid as a table with letter cells
- For the Farcaster integration, wrap everything in a context detection hook so SDK calls are safely no-ops in browser
- The GriddlePremium contract is ~50 lines, deploy to Base after the core game is working
- The oracle contract is an extension of the existing LHAW oracle — coordinate with LHAW codebase

Good luck. The game is mechanically novel, the word bank is ready, and the puzzle math is proven. Build the thing.
