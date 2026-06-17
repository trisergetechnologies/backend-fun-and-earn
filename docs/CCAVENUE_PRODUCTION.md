# CCAvenue Production Setup

## Live payment URL

```
https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction
```

Set `CCAVENUE_ENV=live` in backend `.env`.

## Production callback URLs (register with CCAvenue)

```
https://amp-api.mpdreams.in/api/v1/public/ccavenue/callback
https://amp-api.mpdreams.in/api/v1/public/ccavenue/cancel
```

These are sent as `redirect_url` and `cancel_url` on every payment request.

## Backend `.env` (production server)

```env
PAYMENT_GATEWAY=ccavenue
CCAVENUE_ENV=live
BACKEND_URL=https://amp-api.mpdreams.in/api/v1
FRONTEND_URL=dreammart://

CCAVENUE_MERCHANT_ID=<your MID>
CCAVENUE_ACCESS_CODE=<LIVE access code>
CCAVENUE_WORKING_KEY=<LIVE working key>
```

Use **LIVE** Access Code and Working Key from M.A.R.S → Settings → API Keys (not test keys).

## Client

```env
EXPO_PUBLIC_BASE_URL=https://amp-api.mpdreams.in/api/v1
EXPO_PUBLIC_PAYMENT_GATEWAY=ccavenue
```

## Email CCAvenue to whitelist production URLs

**To:** service@ccavenue.com  
**Subject:** Whitelist production callback URLs — MID `{MERCHANT_ID}`

```
Please whitelist the following production URLs for Merchant ID: {MERCHANT_ID}

https://amp-api.mpdreams.in/api/v1/public/ccavenue/callback
https://amp-api.mpdreams.in/api/v1/public/ccavenue/cancel

Also whitelist server IP if required: {production server public IP}
```
