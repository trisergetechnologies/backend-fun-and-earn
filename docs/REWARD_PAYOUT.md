# Weekly & monthly reward payout

Admin-triggered distribution from `SystemWallet.weeklyPool` and `SystemWallet.monthlyPool` to users who hold achievements and meet eligibility rules.

## API (admin)

| Method | Path | Handler |
|--------|------|---------|
| `POST` | `/shortvideo/admin/payoutweeklyrewards` | `payoutWeeklyRewards` |
| `POST` | `/shortvideo/admin/payoutmonthlyrewards` | `payoutMonthlyRewards` |

Related read-only endpoints: `GET /shortvideo/admin/rewards/payout-eligible`, user `GET /shortvideo/rewards/payout-eligible`.

## Pool & level split

1. Read pool amount (`weeklyPool` or `monthlyPool`).
2. **Atomic claim:** `findOneAndUpdate` sets the pool to `0` only when `pool > 0`. A second concurrent request gets no pool and returns `"No funds in … pool"`.
3. `perLevel = round2(poolAmount / 10)` — equal split across achievement levels 1–10.
4. For each level, load achievers (`Achievement` or `MonthlyAchievement`).

## Share calculation (eligible users only)

At each level:

```text
eligibleCount = achievers at this level who pass eligibility (see below)
share         = round2(perLevel / eligibleCount)
```

- **Only eligible users** are paid. Ineligible achievers are excluded from the denominator; their portion is **not** returned per user — the full `perLevel` bucket is shared among eligible users only.
- If **no** eligible achievers exist at a level (but achievers do), the full `perLevel` for that level returns to `SystemWallet.totalBalance`.
- If **no** achievers exist at a level, the full `perLevel` returns to `totalBalance` (unused bucket).
- Rounding remainder (`perLevel - share × eligibleCount`) returns to `totalBalance`.

**Example:** pool ₹11,435 → `perLevel` ₹1,143.50. Level 1 has 28 eligible users → `share = round2(1143.5 / 28) = ₹40.84` each.

Levels **4–10** have no new-buyer gate: every achiever at that level is payable.

## Eligibility (levels 1–3)

Controlled by `REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK` and [`rewardPayoutConfig.js`](../src/shortVideo/helpers/rewardPayoutConfig.js):

| Pool | L1 | L2 | L3 |
|------|----|----|-----|
| Weekly | 1 new downline buyer | 3 | 5 |
| Monthly | 2 | 6 | 10 |

“New” = distinct successful `PackageOrder` buyers in the user’s 10-level downline since `lastWeeklyPayoutAt` / `lastMonthlyPayoutAt` (epoch on first payout). Logic: [`rewardPayoutEligibility.js`](../src/shortVideo/helpers/rewardPayoutEligibility.js).

When `REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK=true`, all achievers count as eligible.

## Logging & audit

- Per-user credits: `earninglogs` (`weeklyReward` / `monthlyReward`).
- Summary outflow per run: `systemearninglogs` with `type: outflow`, `amount: totalPaid`.
- `totalPaid` = sum of shares **actually credited** in that run (not the full level bucket when users were skipped).
- Ineligible / unused / rounding returns: `systemearninglogs` `type: inflow`.

## Admin UI safeguards

[`WalletActionBar.tsx`](../../Fun-Earn---Admin-Dashboard/src/components/admin/system-wallet/WalletActionBar.tsx): payout buttons and confirm modal use a shared `loading` state to prevent double-submit while a payout request is in flight. Backend atomic claim remains the primary guard.

## Key source files

| File | Role |
|------|------|
| [`system.controller.admin.js`](../src/shortVideo/controllers/admin/system.controller.admin.js) | Payout handlers, `collectPayableAchievers`, atomic claim |
| [`rewardPayoutConfig.js`](../src/shortVideo/helpers/rewardPayoutConfig.js) | Thresholds, env skip flag |
| [`rewardPayoutEligibility.js`](../src/shortVideo/helpers/rewardPayoutEligibility.js) | Downline buyer counts |
| [`rewardsPayoutEligible.service.js`](../src/shortVideo/services/rewardsPayoutEligible.service.js) | User-facing payout-ready list |
| [`adminPayoutEligible.service.js`](../src/shortVideo/services/adminPayoutEligible.service.js) | Admin payout-ready list |
| [`payoutRewards.eligibility.test.js`](../src/shortVideo/controllers/admin/__tests__/payoutRewards.eligibility.test.js) | Payout + eligibility tests |

## Environment

```env
# false (default) = enforce L1–L3 new-buyer rules; true = pay all achievers
REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK=false
```

## Deploy notes

1. Deploy **backend** first (atomic claim + eligible-only split).
2. Deploy **admin dashboard** second (button loading guards).
3. No DB migration required.
4. After deploy: run one payout, confirm a second immediate attempt returns “No funds in pool” and `totalPaid` matches sum of new `earninglogs`.
