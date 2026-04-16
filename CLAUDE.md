# CLAUDE.md

Project-specific guidance for Claude Code working on Griddle.

## Milestone naming

Every dev milestone follows **`M<phase>-<slug>`** — no letter suffixes, always a slug.

- Phase is an integer that maps to a theme (platform, wallets, identity, etc.). See README → Milestone Status → Phases for the current catalog.
- Slug is kebab-case scope (e.g. `db`, `wallets`, `email-auth`, `signin-framing`).
- Never use `M4a`, `M4h`, `M5a`-style IDs. They don't communicate scope and don't survive phase shifts.
- Slot new work into the matching phase; open a new phase only when a cluster of upcoming work genuinely doesn't fit an existing theme.
- Reference milestones by full ID in commits, PRs, and changelog entries: `M6-email-auth`, never `email-auth` or `M6` alone.

See `README.md` → "Milestone Status" → "Conventions" for the authoritative rules.

## Curly quotes — UI only

`’`, `“`, `”` in user-facing text only (copy, share text, OG images, email, toasts, modals). **Use regular ASCII `'` and `"` in all code** — JSX attributes, JSON, regex, string literals, commit messages. Curly quotes in code break parsers and string matching; we’ve shipped bugs from this several times.

## Git workflow

- Every change after M1 goes through a feature branch + PR. Never commit directly to `main`.
- Cursor Bugbot reviews PRs automatically; address its comments and push fixes before merging.
