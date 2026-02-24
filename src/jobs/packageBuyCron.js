const CRON_NAME = 'PACKAGE_BUY_CRON';
const runId = `${CRON_NAME}_${Date.now()}`;
console.log(`🔥 [${CRON_NAME}] file loaded at ${new Date().toISOString()}`);

const cron = require('node-cron');
const axios = require('axios');
const Order = require('../eCart/models/Order');
const User = require('../models/User');
const Package = require('../models/Package');
const Product = require('../eCart/models/Product');

// Replace with your actual internal API base URL
const INTERNAL_API_BASE = 'https://amp-api.mpdreams.in/api/v1/shortvideo/user/package/purchasepackageinternal'

cron.schedule('*/6 * * * *', async () => {
  const runId = `${CRON_NAME}_${Date.now()}`;
  const startedAt = Date.now();

  console.log(`\n⏰ [${CRON_NAME}] RUN START`, {
    runId,
    time: new Date().toISOString()
  });

  let orders = [];

  try {
    orders = await Order.find({
      paymentStatus: 'paid',
      isPackageCronProcessed: false
    }).populate({
      path: 'items.productId',
      select: 'isSpecial package isActive'
    }).populate({
      path: 'buyerId',
      select: 'package token'
    });

    console.log(`📦 [${CRON_NAME}] Orders fetched`, {
      runId,
      count: orders.length
    });

  } catch (err) {
    console.error(`❌ [${CRON_NAME}] Order fetch failed`, err.message);
    return; // abort this run, try next cycle
  }

  if (!orders.length) {
    console.log(`ℹ️ [${CRON_NAME}] No unprocessed paid orders`, { runId });
    return;
  }

  for (const order of orders) {

    console.log(`➡️ [${CRON_NAME}] Processing order`, {
      runId,
      orderId: order._id.toString()
    });

    try {
      await processOrder(order);

      console.log(`✅ [${CRON_NAME}] Order processed`, {
        runId,
        orderId: order._id.toString()
      });

    } catch (err) {
      // Unexpected error for this order — log and continue to next
      console.error(`🔥 [${CRON_NAME}] Order failed of order ${order._id} runId ${runId}:`, err.message);
    }
  }

  console.log(`🏁 [${CRON_NAME}] RUN END`, {
    runId,
    durationMs: Date.now() - startedAt
  });

  console.log('[PackageCron] Cycle complete.');
});


async function processOrder(order, runId) {
  // --- Step 1: Collect all special products and their packages ---

  console.log(`🔍 [${CRON_NAME}] Scanning order items`, {
    runId,
    orderId: order._id.toString(),
    itemsCount: order.items.length
  });
  const specialPackages = [];

  for (const item of order.items) {
    const product = item.productId; // populated

    if (!product || !product.isSpecial || !product.package || !product.isActive) continue;

    specialPackages.push(product.package); // ObjectId ref to Package

    console.log(`🎯 [${CRON_NAME}] Special product found`, {
      runId,
      orderId: order._id.toString(),
      packageId: product.package?.toString()
    });

  }

  // --- Step 2: No special products → mark and move on ---
  if (!specialPackages.length) {
    console.log(`⚠️ [${CRON_NAME}] No special packages`, {
      runId,
      orderId: order._id.toString()
    });
    await markProcessed(order._id, runId);
    return;
  }

  // --- Step 3: Populate all candidate packages and find the one with highest price ---



  let packageDocs = [];
  try {
    // Avoid duplicate package lookups
    const uniquePackageIds = [...new Set(specialPackages.map(id => id.toString()))];

    console.log(`📦 [${CRON_NAME}] Resolving packages`, {
      runId,
      orderId: order._id.toString(),
      candidates: uniquePackageIds
    });
    
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

  console.log(`🏆 [${CRON_NAME}] Best package selected`, {
    runId,
    orderId: order._id.toString(),
    packageId: bestPackage._id.toString(),
    price: bestPackage.price
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

    console.log(`👤 [${CRON_NAME}] Buyer state`, {
      runId,
      orderId: order._id.toString(),
      hasExistingPackage: !!buyer.package
    });

    if (existingPackageDoc && bestPackage.price <= existingPackageDoc.price) {
      console.log(`⏭️ [${CRON_NAME}] Not an upgrade, skipping`, {
        runId,
        orderId: order._id.toString()
      });
      // Not an upgrade — skip axios, mark processed
      await markProcessed(order._id);
      return;
    }
  }

  // --- Step 5: Call axios to assign/upgrade the package ---
  try {

    console.log(`🌐 [${CRON_NAME}] Calling internal API`, {
      runId,
      orderId: order._id.toString(),
      packageId: bestPackage._id.toString()
    });

    const token = buyer.token;
    await axios.post(`${INTERNAL_API_BASE}`, {
      packageId: bestPackage._id,
      orderId: order._id
    }, {headers: {Authorization: `Bearer ${token}`}});

    console.log(`🎉 [${CRON_NAME}] Package assigned`, {
      runId,
      orderId: order._id.toString()
    });

    // Axios succeeded — mark processed
    await markProcessed(order._id);

  } catch (err) {
    const status = err.response?.status;
    console.error(`🚨 [${CRON_NAME}] Internal API failed`, {
      runId,
      orderId: order._id.toString(),
      status: err.response?.status,
      data: err.response?.data,
      error: err.message
    });
    // Leave isPackageCronProcessed: false → will retry next cron run
  }
}


async function markProcessed(orderId, runId) {
  try {
    await Order.findByIdAndUpdate(orderId, { isPackageCronProcessed: true });
    console.log(`📝 [${CRON_NAME}] Marked processed`, {
      runId,
      orderId: orderId.toString()
    });
  } catch (err) {
    console.error(`❌ [${CRON_NAME}] Mark processed failed`, {
      runId,
      orderId: orderId.toString(),
      error: err.message
    });
  }
}