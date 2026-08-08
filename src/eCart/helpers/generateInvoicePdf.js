const fs = require('fs');
const path = require('path');
const moment = require('moment');
const PDFDocument = require('pdfkit');

/**
 * Generate (or reuse) a tax invoice PDF for an order.
 * @param {object} order - Mongoose order doc (or lean) with items + deliveryAddress
 * @param {{ host: string, force?: boolean }} options
 * @returns {Promise<{ filePath: string, publicUrl: string, cached: boolean }>}
 */
function generateInvoicePdf(order, { host, force = false } = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (!order?._id) {
        return reject(new Error('Order is required'));
      }
      if (!host) {
        return reject(new Error('host is required'));
      }

      const invoicesDir = path.join(process.cwd(), 'invoices');
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }

      const filePath = path.join(invoicesDir, `invoice-${order._id}.pdf`);
      const publicUrl = `https://${host}/invoices/invoice-${order._id}.pdf`;

      if (!force && fs.existsSync(filePath)) {
        return resolve({ filePath, publicUrl, cached: true });
      }

      if (force && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const addr = order.deliveryAddress || {};
      const doc = new PDFDocument({ margin: 0, size: 'A4' });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      const PAGE_W = doc.page.width;
      const PAGE_H = doc.page.height;
      const M = 40;
      const CW = PAGE_W - M * 2;

      const G1 = '#10b981';
      const G2 = '#059669';
      const G3 = '#d1fae5';
      const INK = '#0f172a';
      const INK2 = '#334155';
      const MUTED = '#94a3b8';
      const BORDER = '#e2e8f0';
      const BG_LIGHT = '#f8fafc';
      const BG_STRIP = '#f1f5f9';
      const WHITE = '#ffffff';

      // 1. HEADER
      doc.rect(0, 0, PAGE_W, 90).fill(G2);
      doc.rect(PAGE_W - 180, 0, 180, 90).fill(G1);
      doc.rect(0, 90, PAGE_W, 4).fill(G3);

      doc
        .font('Helvetica-Bold')
        .fontSize(16)
        .fillColor(WHITE)
        .text('AARUSH MP DREAMS (OPC) Pvt. Ltd.', M, 18, { width: CW - 130 });

      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('rgba(255,255,255,0.75)')
        .text('No. 242, Araliganur, Siruguppa - 583121, Karnataka', M, 42)
        .text('GSTIN: 29ABBCA7044H1ZN', M, 55);

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(WHITE)
        .text('TAX INVOICE', PAGE_W - 175, 30, { width: 165, align: 'center' });
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('rgba(255,255,255,0.8)')
        .text('ORIGINAL FOR RECIPIENT', PAGE_W - 175, 50, {
          width: 165,
          align: 'center',
        });

      // 2. META STRIP
      doc.rect(0, 94, PAGE_W, 46).fill(BG_STRIP);
      doc.rect(0, 139, PAGE_W, 1).fill(BORDER);

      const metaCols = [
        {
          label: 'INVOICE NO',
          value: `#${order._id.toString().slice(-10).toUpperCase()}`,
        },
        {
          label: 'DATE',
          value: moment(order.createdAt).format('DD MMM YYYY'),
        },
        {
          label: 'ORDER STATUS',
          value: String(order.status || '').toUpperCase(),
        },
        {
          label: 'PAYMENT',
          value: String(order.paymentStatus || '').toUpperCase(),
        },
      ];

      const mColW = CW / metaCols.length;
      metaCols.forEach((col, i) => {
        const x = M + i * mColW;
        if (i > 0) doc.rect(x - 1, 100, 1, 32).fill(BORDER);
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(MUTED)
          .text(col.label, x + 8, 103, { width: mColW - 16 });
        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(INK)
          .text(col.value, x + 8, 116, { width: mColW - 16 });
      });

      // 3. BILLED TO + ORDER INFO
      const secY = 150;
      const leftW = CW * 0.52;
      const rightX = M + leftW + 20;
      const rightW = CW - leftW - 20;

      doc.roundedRect(M, secY, leftW, 88, 5).fill(BG_LIGHT);
      doc.roundedRect(M, secY, leftW, 88, 5).stroke(BORDER);
      doc.roundedRect(M, secY, 4, 88, 2).fill(G1);

      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(G1)
        .text('BILLED TO', M + 14, secY + 10);
      doc
        .font('Helvetica-Bold')
        .fontSize(11.5)
        .fillColor(INK)
        .text(addr.fullName || '', M + 14, secY + 23, { width: leftW - 20 });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(INK2)
        .text(addr.street || '', M + 14, secY + 40, { width: leftW - 20 })
        .text(
          `${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`,
          M + 14,
          secY + 53,
          { width: leftW - 20 }
        )
        .text(`Ph: ${addr.phone || ''}`, M + 14, secY + 66, {
          width: leftW - 20,
        });

      doc.roundedRect(rightX, secY, rightW, 88, 5).fill(BG_LIGHT);
      doc.roundedRect(rightX, secY, rightW, 88, 5).stroke(BORDER);
      doc.roundedRect(rightX, secY, 4, 88, 2).fill(G1);

      const rMeta = [
        { label: 'ORDER ID', value: order._id.toString() },
        {
          label: 'PAYMENT VIA',
          value: (order.paymentInfo?.gateway || 'online').toUpperCase(),
        },
        ...(order.usedCouponCode
          ? [{ label: 'COUPON', value: order.usedCouponCode }]
          : []),
      ];

      let rY = secY + 10;
      rMeta.forEach((m) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .fillColor(G1)
          .text(m.label, rightX + 14, rY, { width: rightW - 20 });
        rY += 12;
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor(INK)
          .text(m.value, rightX + 14, rY, { width: rightW - 20 });
        rY += 16;
      });

      // 4. ITEMS TABLE
      const tY = secY + 100;
      const cols = {
        sno: { x: M, w: 24 },
        product: { x: M + 26, w: 222 },
        qty: { x: M + 252, w: 40 },
        price: { x: M + 296, w: 80 },
        disc: { x: M + 380, w: 68 },
        total: { x: M + 450, w: CW - 450 },
      };

      doc.rect(M, tY, CW, 26).fill(INK);

      const thY = tY + 7;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(WHITE);
      doc.text('#', cols.sno.x + 4, thY, { width: cols.sno.w });
      doc.text('PRODUCT', cols.product.x, thY, { width: cols.product.w });
      doc.text('QTY', cols.qty.x, thY, { width: cols.qty.w, align: 'center' });
      doc.text('UNIT PRICE', cols.price.x, thY, {
        width: cols.price.w,
        align: 'right',
      });
      doc.text('DISCOUNT', cols.disc.x, thY, {
        width: cols.disc.w,
        align: 'right',
      });
      doc.text('SUBTOTAL', cols.total.x, thY, {
        width: cols.total.w,
        align: 'right',
      });

      let rowY = tY + 26;
      const items = Array.isArray(order.items) ? order.items : [];

      items.forEach((item, i) => {
        const ROW_H = 28;
        doc.rect(M, rowY, CW, ROW_H).fill(i % 2 === 0 ? WHITE : BG_STRIP);
        doc.rect(M, rowY + ROW_H - 0.5, CW, 0.5).fill(BORDER);

        const unitPrice = item.priceAtPurchase || 0;
        const finalPrice = item.finalPriceAtPurchase || 0;
        const qty = item.quantity || 1;
        const discAmt = (unitPrice - finalPrice) * qty;
        const rowTotal = finalPrice * qty;
        const tRow = rowY + 8;

        doc.circle(cols.sno.x + 10, tRow + 5, 9).fill(i % 2 === 0 ? G3 : BORDER);
        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(G2)
          .text(`${i + 1}`, cols.sno.x + 4, tRow + 1, {
            width: cols.sno.w,
            align: 'center',
          });

        doc
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .fillColor(INK)
          .text(item.productTitle || '', cols.product.x, tRow, {
            width: cols.product.w,
            ellipsis: true,
          });

        doc.font('Helvetica').fontSize(8.5).fillColor(INK2);
        doc.text(qty.toString(), cols.qty.x, tRow, {
          width: cols.qty.w,
          align: 'center',
        });
        doc.text(`Rs.${unitPrice.toFixed(2)}`, cols.price.x, tRow, {
          width: cols.price.w,
          align: 'right',
        });

        if (discAmt > 0) {
          doc
            .font('Helvetica-Bold')
            .fillColor(G2)
            .text(`-Rs.${discAmt.toFixed(2)}`, cols.disc.x, tRow, {
              width: cols.disc.w,
              align: 'right',
            });
        } else {
          doc
            .font('Helvetica')
            .fillColor(MUTED)
            .text('—', cols.disc.x, tRow, {
              width: cols.disc.w,
              align: 'right',
            });
        }

        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(INK)
          .text(`Rs.${rowTotal.toFixed(2)}`, cols.total.x, tRow, {
            width: cols.total.w,
            align: 'right',
          });

        rowY += ROW_H;
      });

      doc.rect(M, rowY, CW, 3).fill(G1);

      // 5. SUMMARY CARD
      const sumStartY = rowY + 16;
      const subTotal = order.totalAmount || 0;
      const gstAmount = order.totalGstAmount || 0;
      const deliveryCharge = order.deliveryCharge || 0;
      const walletUsed = order.usedWalletAmount || 0;
      const finalPaid = order.finalAmountPaid || 0;

      const summaryRows = [
        {
          label: 'Subtotal (excl. GST)',
          value: `Rs.${subTotal.toFixed(2)}`,
        },
        { label: 'GST', value: `Rs.${gstAmount.toFixed(2)}` },
        {
          label: 'Delivery Charges',
          value:
            deliveryCharge > 0 ? `Rs.${deliveryCharge.toFixed(2)}` : 'FREE',
        },
        ...(walletUsed > 0
          ? [
              {
                label: 'Wallet Discount',
                value: `-Rs.${walletUsed.toFixed(2)}`,
                green: true,
              },
            ]
          : []),
      ];

      const SUM_W = 248;
      const SUM_X = PAGE_W - M - SUM_W;
      const ROW_HS = 24;
      const CARD_H = summaryRows.length * ROW_HS + 48;

      doc
        .roundedRect(SUM_X + 2, sumStartY + 2, SUM_W, CARD_H, 6)
        .fill('#dde3ed');
      doc.roundedRect(SUM_X, sumStartY, SUM_W, CARD_H, 6).fill(WHITE);
      doc.roundedRect(SUM_X, sumStartY, SUM_W, CARD_H, 6).stroke(BORDER);

      let sY = sumStartY + 10;
      summaryRows.forEach((row, i) => {
        if (i > 0) doc.rect(SUM_X + 10, sY - 1, SUM_W - 20, 0.5).fill(BORDER);

        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(row.label, SUM_X + 14, sY + 4, { width: SUM_W * 0.55 });

        doc
          .font(row.green ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .fillColor(row.green ? G2 : INK)
          .text(row.value, SUM_X + 14 + SUM_W * 0.55, sY + 4, {
            width: SUM_W * 0.36,
            align: 'right',
          });

        sY += ROW_HS;
      });

      const totalBandY = sumStartY + CARD_H - 40;
      doc.rect(SUM_X, totalBandY, SUM_W, 10).fill(WHITE);
      doc.roundedRect(SUM_X, totalBandY + 8, SUM_W, 32, 6).fill(G1);
      doc.rect(SUM_X, totalBandY + 8, SUM_W, 10).fill(G1);

      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(WHITE)
        .text('TOTAL AMOUNT PAID', SUM_X + 14, totalBandY + 14, {
          width: SUM_W * 0.55,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(WHITE)
        .text(
          `Rs.${finalPaid.toFixed(2)}`,
          SUM_X + 14 + SUM_W * 0.55,
          totalBandY + 12,
          { width: SUM_W * 0.35, align: 'right' }
        );

      if (order.usedCouponCode || walletUsed > 0) {
        const noteW = SUM_X - M - 20;
        const noteH = order.usedCouponCode && walletUsed > 0 ? 58 : 40;
        doc.roundedRect(M, sumStartY, noteW, noteH, 5).fill(G3);
        doc.roundedRect(M, sumStartY, 4, noteH, 2).fill(G1);

        doc
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor(G2)
          .text('SAVINGS APPLIED', M + 14, sumStartY + 10);
        let nY = sumStartY + 24;
        if (order.usedCouponCode) {
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor(INK2)
            .text(`Coupon: ${order.usedCouponCode}`, M + 14, nY);
          nY += 14;
        }
        if (walletUsed > 0) {
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor(INK2)
            .text(`Wallet: -Rs.${walletUsed.toFixed(2)}`, M + 14, nY);
        }
      }

      // 6. FOOTER
      const footerY = PAGE_H - 52;
      doc.rect(0, footerY, PAGE_W, 3).fill(G1);
      doc.rect(0, footerY + 3, PAGE_W, 49).fill(INK);

      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('rgba(255,255,255,0.5)')
        .text(
          'This is a computer-generated invoice. No signature required.  |  Subject to Siruguppa jurisdiction.',
          M,
          footerY + 12,
          { width: CW, align: 'center' }
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('rgba(255,255,255,0.75)')
        .text(
          'AARUSH MP DREAMS (OPC) Pvt. Ltd.  |  GSTIN: 29ABBCA7044H1ZN  |  Thank you for shopping with Dream Mart!',
          M,
          footerY + 28,
          { width: CW, align: 'center' }
        );
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('rgba(255,255,255,0.3)')
        .text('Page 1 of 1', M, footerY + 40, {
          width: CW,
          align: 'right',
        });

      doc.end();

      writeStream.on('finish', () => {
        resolve({ filePath, publicUrl, cached: false });
      });

      writeStream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function isInvoiceEligible(order) {
  if (!order) return false;
  const paid = String(order.paymentStatus || '').toLowerCase() === 'paid';
  const cancelled = String(order.status || '').toLowerCase() === 'cancelled';
  return paid && !cancelled;
}

module.exports = {
  generateInvoicePdf,
  isInvoiceEligible,
};
