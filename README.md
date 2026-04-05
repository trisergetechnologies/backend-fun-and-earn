# backend-fun-and-earn

## Environment variables

| Variable | Values | Description |
|----------|--------|-------------|
| `TEAM_TREE_MODE` | `legacy` (default) or `aggregate` | `getTeam` (user + admin): `legacy` uses recursive `User.find`; `aggregate` uses a single `$graphLookup` + in-memory tree. Set to `aggregate` after verifying responses match your expectations. |
