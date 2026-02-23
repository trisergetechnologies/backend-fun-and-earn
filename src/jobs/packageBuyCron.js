const cron = require('node-cron');
const axios = require('axios');
const Order = require('../eCart/models/Order');
const User = require('../models/User');
const Package = require('../models/Package');
const Product = require('../eCart/models/Product');

// Replace with your actual internal API base URL
const INTERNAL_API_BASE = 'https://api.mpdreams.in/api/v1/shortvideo/user/package/purchasepackageinternal'

cron.schedule('*/3 * * * *', async () => {
  console.log('[PackageCron] Running at', new Date().toISOString());

  let orders = [];

  try {
    orders = await Order.find({
      paymentStatus: 'paid',
      isPackageCronProcessed: false
    }).populate({
      path: 'items.productId',
      select: 'isSpecial package'
    }).populate({
      path: 'buyerId',
      select: 'package token'
    });
  } catch (err) {
    console.error('[PackageCron] Failed to fetch orders:', err.message);
    return; // abort this run, try next cycle
  }

  if (!orders.length) {
    console.log('[PackageCron] No unprocessed paid orders found.');
    return;
  }

  for (const order of orders) {
    try {
      await processOrder(order);
    } catch (err) {
      // Unexpected error for this order — log and continue to next
      console.error(`[PackageCron] Unexpected error on order ${order._id}:`, err.message);
    }
  }

  console.log('[PackageCron] Cycle complete.');
});


async function processOrder(order) {
  // --- Step 1: Collect all special products and their packages ---
  const specialPackages = [];

  for (const item of order.items) {
    const product = item.productId; // populated

    if (!product || !product.isSpecial || !product.package || !product.isActive) continue;

    specialPackages.push(product.package); // ObjectId ref to Package
  }

  // --- Step 2: No special products → mark and move on ---
  if (!specialPackages.length) {
    await markProcessed(order._id);
    return;
  }

  // --- Step 3: Populate all candidate packages and find the one with highest price ---
  let packageDocs = [];
  try {
    // Avoid duplicate package lookups
    const uniquePackageIds = [...new Set(specialPackages.map(id => id.toString()))];
    
    packageDocs = await Package.find({ _id: { $in: uniquePackageIds }, isActive: true }).select('price');
  } catch (err) {
    console.error(`[PackageCron] Failed to fetch packages for order ${order._id}:`, err.message);
    return; // leave isPackageCronProcessed: false → retry next run
  }

  if (!packageDocs.length) {
    // No active packages found — mark processed to avoid infinite retries on bad data
    await markProcessed(order._id);
    return;
  }

  // Pick package with the highest price
  const bestPackage = packageDocs.reduce((best, pkg) => {
    return pkg.price > best.price ? pkg : best;
  });

  // --- Step 4: Check user's existing package ---
  const buyer = order.buyerId; // populated

  if (!buyer) {
    console.error(`[PackageCron] buyerId not populated for order ${order._id}, skipping.`);
    await markProcessed(order._id);
    return;
  }

  if (buyer.package) {
    // User already has a package — check if it's an upgrade
    let existingPackageDoc = null;
    try {
      existingPackageDoc = await Package.findById(buyer.package).select('price');
    } catch (err) {
      console.error(`[PackageCron] Failed to fetch user's existing package for order ${order._id}:`, err.message);
      return; // retry next run
    }

    if (existingPackageDoc && bestPackage.price <= existingPackageDoc.price) {
      // Not an upgrade — skip axios, mark processed
      await markProcessed(order._id);
      return;
    }
  }

  // --- Step 5: Call axios to assign/upgrade the package ---
  try {
    const token = buyer.token;
    await axios.post(`${INTERNAL_API_BASE}`, {
      packageId: bestPackage._id,
      orderId: order._id
    }, {headers: {Authorization: `Bearer ${token}`}});

    // Axios succeeded — mark processed
    await markProcessed(order._id);

  } catch (err) {
    const status = err.response?.status;
    console.error(
      `[PackageCron] Axios call failed for order ${order._id}. Status: ${status || 'N/A'}, Message: ${err.message}`
    );
    // Leave isPackageCronProcessed: false → will retry next cron run
  }
}


async function markProcessed(orderId) {
  try {
    await Order.findByIdAndUpdate(orderId, { isPackageCronProcessed: true });
  } catch (err) {
    console.error(`[PackageCron] Failed to mark order ${orderId} as processed:`, err.message);
  }
}