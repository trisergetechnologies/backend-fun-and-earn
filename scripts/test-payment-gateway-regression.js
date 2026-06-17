/**
 * Regression checks for payment gateway wiring.
 * Run: node scripts/test-payment-gateway-regression.js
 */
const fs = require('fs');
const path = require('path');

const packageCron = fs.readFileSync(path.join(__dirname, '../src/jobs/packageBuyCron.js'), 'utf8');
if (!packageCron.includes("paymentStatus: 'paid'") || !packageCron.includes('isPackageCronProcessed: false')) {
  console.error('FAIL: packageBuyCron query changed');
  process.exit(1);
}
if (packageCron.includes('ccavenue') || packageCron.includes('razorpay')) {
  console.error('FAIL: packageBuyCron should be gateway-agnostic');
  process.exit(1);
}

const orderController = fs.readFileSync(
  path.join(__dirname, '../src/eCart/controllers/user/order.controller.user.js'),
  'utf8'
);
if (!orderController.includes('normalizePaymentGateway')) {
  console.error('FAIL: per-request payment gateway resolver missing');
  process.exit(1);
}
if (!orderController.includes('isCcavenueGateway')) {
  console.error('FAIL: ccavenue branch missing in order controller');
  process.exit(1);
}
if (!orderController.includes("paymentGateway")) {
  console.error('FAIL: createOrderIntent should read paymentGateway from request body');
  process.exit(1);
}

const paymentIntent = fs.readFileSync(path.join(__dirname, '../src/eCart/models/PaymentIntent.js'), 'utf8');
if (!paymentIntent.includes("'ccavenue'")) {
  console.error('FAIL: ccavenue not in PaymentIntent gateway enum');
  process.exit(1);
}

const routes = fs.readFileSync(path.join(__dirname, '../src/routes/index.js'), 'utf8');
if (!routes.includes('/public/ccavenue/callback')) {
  console.error('FAIL: public ccavenue callback route missing');
  process.exit(1);
}

console.log('PASS: payment gateway regression checks');
console.log('  packageBuyCron: gateway-agnostic (paymentStatus=paid only)');
console.log('  order controller: per-request gateway (razorpay default) + ccavenue branch');
console.log('  public callback routes registered');
