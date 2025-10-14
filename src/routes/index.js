const express = require('express');
const router = express.Router();

//common router imports
const authRouter = require('./auth.routes');

//eCart router import
const eCartRouter = require('../eCart/routes');
const shortVideoRouter = require('../shortVideo/routes');

//Common Routes
router.use('/auth', authRouter);

//eCart Routes
router.use('/ecart', eCartRouter);
router.use('/shortvideo', shortVideoRouter);

// router.post('/payment/razorpay-redirect', async (req, res) => {
//     try {
//         const { intent, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.query;

//         if (!intent || !razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
//             console.warn('[Bridge] Missing Razorpay params:', req.query);
//             return res
//                 .status(400)
//                 .send(`<h2>⚠️ Invalid Redirect</h2><p>Missing parameters. Please reopen Dream Mart app.</p>`);
//         }

//         // Build deep link (must match your Expo scheme)
//         const deepLink = `dreammart://private/success?intent=${encodeURIComponent(
//             intent
//         )}&razorpay_payment_id=${encodeURIComponent(
//             razorpay_payment_id
//         )}&razorpay_order_id=${encodeURIComponent(
//             razorpay_order_id
//         )}&razorpay_signature=${encodeURIComponent(razorpay_signature)}`;

//         console.log('[Bridge] Redirecting →', deepLink);

//         // Return small HTML that auto-redirects & provides manual button
//         const html = `
// <!DOCTYPE html>
// <html lang="en">
// <head>
// <meta charset="UTF-8" />
// <meta name="viewport" content="width=device-width, initial-scale=1.0" />
// <title>Redirecting to Dream Mart</title>
// <style>
//   body{font-family:sans-serif;text-align:center;margin-top:10%;}
//   a.button{background:#10b981;color:white;padding:14px 24px;text-decoration:none;border-radius:6px;}
// </style>
// <script>
//   setTimeout(() => { window.location.href = '${deepLink}'; }, 800);
// </script>
// </head>
// <body>
//   <h2>🎉 Payment Successful</h2>
//   <p>You are being redirected to the Dream Mart app...</p>
//   <p>If it doesn’t open automatically, tap below:</p>
//   <a class="button" href="${deepLink}">Open in Dream Mart</a>
// </body>
// </html>`;
//         res.status(200).send(html);
//     } catch (err) {
//         console.error('[Bridge] Error:', err);
//         res
//             .status(500)
//             .send('<h2>❌ Error</h2><p>Unable to complete redirect. Please reopen Dream Mart app.</p>');
//     }
// });

exports.razorpayRedirectBridge = async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, intent } = req.query;
  console.log('[Bridge] Incoming params:', req.query);

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !intent) {
    console.warn('[Bridge] Missing Razorpay params:', req.query);
    return res.status(400).send('Missing payment confirmation data from Razorpay');
  }

  const deepLink = `dreammart://private/success?intent=${intent}&razorpay_payment_id=${razorpay_payment_id}&razorpay_order_id=${razorpay_order_id}&razorpay_signature=${razorpay_signature}`;
  console.log('[Bridge] Redirecting user to:', deepLink);
  return res.redirect(302, deepLink);
};
router.post('/payment/razorpay-redirect', razorpayRedirectBridge);

module.exports = router;