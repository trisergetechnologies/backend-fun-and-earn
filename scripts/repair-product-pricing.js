/**
 * Migrate Dream Mart products to inclusive pricing inputs:
 *   basePrice, transportCharge, discountAmount
 * and recompute BC snapshots: price, finalPrice, discountPercent.
 *
 * Old model: price = ex-GST list, discountPercent %, finalPrice = price*(1-pct/100), GST at checkout.
 * New model: basePrice + transport - discountAmount, then * (1+gst) into price/finalPrice.
 *
 *   node scripts/repair-product-pricing.js --dry-run
 *   node scripts/repair-product-pricing.js
 *   node scripts/repair-product-pricing.js --force
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const Product = require('../src/eCart/models/Product');
const {
  computeProductPricing,
  round2,
} = require('../src/eCart/helpers/productPricing');

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI / MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected. dryRun=${dryRun} force=${force}`);

  const products = await Product.find({}).lean();
  let updated = 0;
  let skipped = 0;

  for (const p of products) {
    const alreadyMigrated = p.basePrice != null && Number.isFinite(Number(p.basePrice));
    if (alreadyMigrated && !force) {
      // Recompute derived snapshots from stored inputs (idempotent heal)
      const priced = computeProductPricing({
        basePrice: p.basePrice,
        transportCharge: p.transportCharge || 0,
        discountAmount: p.discountAmount || 0,
        gst: p.gst != null ? p.gst : 0.05,
      });
      const needsHeal =
        Math.abs((p.price || 0) - priced.price) > 0.01 ||
        Math.abs((p.finalPrice || 0) - priced.finalPrice) > 0.01 ||
        Math.abs((p.discountPercent || 0) - priced.discountPercent) > 0.01 ||
        Math.abs((p.transportCharge || 0) - priced.transportCharge) > 0.01 ||
        Math.abs((p.discountAmount || 0) - priced.discountAmount) > 0.01;

      if (!needsHeal) {
        skipped += 1;
        continue;
      }

      console.log(
        `heal ${p._id} "${p.title}" base=${priced.basePrice} transport=${priced.transportCharge} discount₹=${priced.discountAmount} → list=${priced.price} sell=${priced.finalPrice} pct=${priced.discountPercent}`
      );
      if (!dryRun) {
        await Product.updateOne(
          { _id: p._id },
          {
            $set: {
              basePrice: priced.basePrice,
              transportCharge: priced.transportCharge,
              discountAmount: priced.discountAmount,
              price: priced.price,
              finalPrice: priced.finalPrice,
              discountPercent: priced.discountPercent,
              gst: priced.gst,
            },
          }
        );
      }
      updated += 1;
      continue;
    }

    // First-time migrate: treat current price as old ex-GST list
    const oldList = Number(p.price) || 0;
    const oldPct = Number(p.discountPercent) || 0;
    const gst = p.gst != null ? Number(p.gst) : 0.05;
    const basePrice = oldList;
    const transportCharge = 0;
    const discountAmount = round2((basePrice * oldPct) / 100);

    const priced = computeProductPricing({
      basePrice,
      transportCharge,
      discountAmount,
      gst,
    });

    console.log(
      `migrate ${p._id} "${p.title}" oldPrice=${oldList} oldPct=${oldPct} → base=${priced.basePrice} discount₹=${priced.discountAmount} list=${priced.price} sell=${priced.finalPrice} pct=${priced.discountPercent}`
    );

    if (!dryRun) {
      await Product.updateOne(
        { _id: p._id },
        {
          $set: {
            basePrice: priced.basePrice,
            transportCharge: priced.transportCharge,
            discountAmount: priced.discountAmount,
            price: priced.price,
            finalPrice: priced.finalPrice,
            discountPercent: priced.discountPercent,
            gst: priced.gst,
          },
        }
      );
    }
    updated += 1;
  }

  console.log(`Done. updated=${updated} skipped=${skipped} total=${products.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
