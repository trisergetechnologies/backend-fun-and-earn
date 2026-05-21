# Database indexes

Schema indexes are declared on Mongoose models under `src/**/models`. They match query patterns used in controllers, crons, and helpers.

## Deploy / production

Indexes do **not** change application behavior — only read performance.

1. **Optional backfill** (only if you had duplicate watch rows):

   ```bash
   npm run db:ensure-indexes:backfill
   ```

   Merges duplicate `VideoWatchHistory` documents (`userId` + `videoId`), summing `watchedDuration`. Run once before or after index sync; idempotent.

2. **Sync indexes** (required after deploy):

   ```bash
   npm run db:ensure-indexes
   ```

   Uses `syncIndexes()` per model (drops indexes removed from schema, creates new ones).

Run during a low-traffic window on large collections. MongoDB builds indexes in the background on supported versions; monitor CPU/disk.

## What was added

| Collection | Index | Driven by |
|------------|--------|-----------|
| VideoWatchHistory | `{ userId, videoId }` | `logWatchTime` findOne |
| Order | `{ buyerId, createdAt }`, cron compound, status/seller admin lists | orders + `packageBuyCron` |
| EarningLog | `{ userId, createdAt }`, `{ source, createdAt }` | tree, admin, aggregates |
| WalletTransaction | `{ userId, createdAt }` | wallet history |
| PackageOrder | `{ buyerId, createdAt }`, `{ buyerId, status, createdAt }` | history + payout eligibility |
| PaymentIntent | `razorpayOrderId`, `{ status, expiresAt }`, `{ userId, idempotencyKey }` | webhooks, reconcile, checkout |
| WithdrawalRequest | `{ user, status }`, `{ status, createdAt }` | pending check, admin |
| Video | `{ userId, createdAt }`, `{ isActive }` | profile, feed |
| Product | category/seller/catalog compounds | eCart browse/search |
| Coupon | `{ earnedBy, createdAt }`, redeem helper | wallet/profile |
| Otp | `{ email }`, `{ email, otp }` | auth / reset |
| Achievement / MonthlyAchievement | `{ level }` | payout jobs |
| SystemEarningLog | `{ createdAt }` | admin logs list |
| Package | `{ isActive, price }` | package catalog |
| User | watchTime sort, partial shortVideoWallet | admin credit / payout sweep |

No new **unique** constraints were added (avoids deploy failures on legacy duplicate data).
