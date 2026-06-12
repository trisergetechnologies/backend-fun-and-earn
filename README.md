# backend-fun-and-earn

## Documentation

- [Weekly & monthly reward payout](docs/REWARD_PAYOUT.md) — pool split, eligible-only share math, atomic claim, eligibility rules, logging.

## Environment variables

| Variable | Values | Description |
|----------|--------|-------------|
| `TEAM_TREE_MODE` | `legacy` (default) or `aggregate` | `getTeam` (user + admin): `legacy` uses recursive `User.find`; `aggregate` uses a single `$graphLookup` + in-memory tree. Set to `aggregate` after verifying responses match your expectations. |
| `REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK` | `true` or `false` (default) | When `false`, weekly/monthly payout enforces new-downline-buyer rules on achievement levels 1–3. When `true`, all achievers at every level are treated as eligible. See [REWARD_PAYOUT.md](docs/REWARD_PAYOUT.md). |
