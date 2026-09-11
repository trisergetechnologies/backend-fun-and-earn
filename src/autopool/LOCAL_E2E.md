# Autopool local E2E checklist

Feature flag defaults to **disabled** (`AutopoolSettings.enabled = false`) so Play Store apps stay safe until you enable.

## Prep

1. Start backend, admin dashboard, Fun-and-Earn-Reels-client (local).
2. Admin → **Auto Pool → Overview** → Seed runs on load → **Enable Autopool**.
3. Admin → **Bootstrap** → enter a user SN that has a package (or any user) → creates occupying Pool 1 without debit.
4. Ensure test user has `package` set and `eCartWallet` ≥ 500.

## Flow

1. App Profile → **Auto Pool** (above Teams) → overview loads (or "Disabled" if flag off).
2. Join Pool 1 with bootstrap user SN → debit eCart, referrer +1 credit, placed.
3. Add more users under the matrix until a parent completes cycle 1 → wallet +20% of collection.
4. After cycle 5 → eligibility on overview; Join Next needs ≥1 credit (have someone use your SN on Join P1).
5. Join Pool 2 → credit −1; both pools occupying.
6. After P1 15/15 with upgrade used → P1 released; can Join P1 again.
7. New P1 while P2 occupying → eligibility held; re-entry blocked until upgrade used.
8. Regression smoke: login, wallet screen, package buy, team tree, Dream Mart order — unchanged.

## Idempotency

Double-tap Join Pool 1 with same `idempotencyKey` → one debit only.
