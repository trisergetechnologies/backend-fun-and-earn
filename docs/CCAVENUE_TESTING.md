# CCAvenue Testing Guide (ngrok + Expo Go)

## 1. Email CCAvenue (required before first test)

**To:** service@ccavenue.com  
**Subject:** Enable test environment + whitelist URLs — MID `{YOUR_MERCHANT_ID}`

```
Please enable test/sandbox environment for Merchant ID: {YOUR_MERCHANT_ID}

Whitelist the following URLs for test credentials:
- https://your-reserved.ngrok-free.app/api/v1/public/ccavenue/callback
- https://your-reserved.ngrok-free.app/api/v1/public/ccavenue/cancel

Also whitelist server IP if required: {your public IP}
```

Wait ~24h, then copy **Test** credentials from M.A.R.S → Settings → API Keys.

## 2. Backend `.env`

```env
PAYMENT_GATEWAY=ccavenue
BACKEND_URL=https://your-reserved.ngrok-free.app/api/v1
CCAVENUE_MERCHANT_ID=...
CCAVENUE_ACCESS_CODE=...
CCAVENUE_WORKING_KEY=...
CCAVENUE_ENV=test
```

## 3. Client env

```env
EXPO_PUBLIC_BASE_URL=https://your-reserved.ngrok-free.app/api/v1
EXPO_PUBLIC_PAYMENT_GATEWAY=ccavenue
```

## 4. Run stack

```bash
# Terminal 1
cd backend-fun-and-earn && npm start

# Terminal 2
ngrok http 3000 --domain=your-reserved.ngrok-free.app

# Terminal 3
cd fun-and-earn-client && npx expo start
```

Use **Expo Go** (CCAvenue does not need native build).

## 5. Test phases

### Phase 1 — Backend smoke
1. Login → JWT
2. Add cart item + address
3. `POST /ecart/user/order/createorderintent`
4. Response must include `paymentPageUrl` (no Razorpay fields)
5. Open `paymentPageUrl` in browser — CCAvenue test page loads (not error 10002/115)

### Phase 2 — E2E in app
1. Cart → Proceed to Pay
2. Complete payment on CCAvenue test page
3. App polls verify → success screen
4. DB: `paymentStatus=paid`, `paymentInfo.gateway=ccavenue`, cart cleared

### Phase 3 — Package buy
1. Order product with `isSpecial: true` + linked package
2. Pay via CCAvenue
3. Wait for `packageBuyCron` (~6 min)
4. User package assigned, `isPackageCronProcessed: true`

### Phase 4 — Failure paths
- Cancel on CCAvenue → order failed, stock restored
- Close browser early → polling resolves WAIT/FAIL

### Phase 5 — Razorpay regression
Set `PAYMENT_GATEWAY=razorpay` on backend and `EXPO_PUBLIC_PAYMENT_GATEWAY=razorpay` on client. Use dev/EAS build (not Expo Go).

## Common errors

| Error | Fix |
|-------|-----|
| 10002 | Wrong keys or URL not whitelisted with CCAvenue |
| 115 | Test environment not enabled — email support |
| Callback not received | `BACKEND_URL` must match registered ngrok URL exactly |
