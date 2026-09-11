# Autopool API E2E — Scenario Catalog

Why these scenarios exist, and what “PASS” means for product confidence.

Mapped to [`AUTO_POOL_SYSTEM_DOCS`](../../AUTO_POOL_SYSTEM_DOCS/).

## Why API-only E2E (vs unit tests / UI)

| Approach | Strength | Gap |
|---|---|---|
| Unit tests (`cycleMath`, gates) | Fast, precise math | No real Mongo transactions, FIFO, or wallet side effects |
| UI clicks | Human confidence | Flaky, slow, not CI-friendly |
| **API E2E (this suite)** | Same contracts as app/admin; real DB; assert money deltas | Needs running backend + admin seed |

We chose API E2E as the best proof that **the exact intended behavior** happens end-to-end without depending on React Native or Next.js screens.

## Fixture helpers (dev-only)

| Endpoint | Why |
|---|---|
| `POST /autopool/admin/e2e/provision` | Register alone cannot grant package + DreamMart balance; emails restricted to `e2e.autopool.*@test.local` |
| `POST /autopool/admin/e2e/reset` | Isolate runs |
| `POST /autopool/admin/e2e/bootstrap-pool` | Place a user in pool N using **same** `placeParticipation` engine (needed for Pool 10 and controlled parents) |
| `POST /autopool/admin/e2e/place-filler` | Fill FIFO seats with real cycle completion path (manual Join P1 cannot enter Pool 10) |

Disabled unless `NODE_ENV=development` or `AUTOPOOL_E2E_ALLOW=true`.

## Scenarios

| ID | Intent | Docs | PASS means |
|---|---|---|---|
| S0 | Seed, enable, bootstrap active referrer | §3 referrer must be Autopool-active | Health enabled; root occupying P1 |
| P_gates | Pain entry gates | §3, edges 1b/18/20/21 | Each reject code; no wrongful debit |
| H1_H2 | Happy Join P1 + idempotency | §3.1, tech idempotency | −500 eCart once; referrer +1 credit; referral event |
| C1_C5 | Cycle 1 money + cycle 5 eligibility | §5–6 | +200 wallet; one AVAILABLE eligibility @1000 for P2 |
| C6_C15 | Cycle 6 Feature redirect; cycle 15 end | §6, §11 | nextPool=0 on C6; COMPLETED at 15; no cycle 16 |
| J_gates | Credit vs eligibility gates + happy Join P2 | §7, §15 | NO_UPGRADE_CREDIT / NO_ELIGIBILITY; then −1 credit + P2 occupying |
| J4_hold | Hold eligibility if P2 already occupying | §10 | AVAILABLE kept; join 409 TARGET_OCCUPYING |
| R_release | Re-entry only after release | §8.1 | Blocked without upgrade; allowed after 15+upgrade used |
| R3_R4_pool10 | Credit reset on Pool10 done | §15.3 | Solo → 0; other occupying → unchanged |
| L1_legacy | Legacy referral untouched | §16, edge 28 | `referredBy` unchanged after Autopool join |

## How to run

```bash
# terminal 1
npm run dev

# terminal 2 (admin must exist: npm run db:seed:local once)
npm run test:autopool-e2e
```

Optional: `node scripts/autopool-e2e/run.js --all` continues after failures.

Results overwrite [`RESULTS.md`](./RESULTS.md) every run.
