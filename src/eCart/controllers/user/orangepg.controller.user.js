// ================================================================
// FILE: controllers/user/orangepg.controller.user.js
// Orange PG Payment Controllers
// ================================================================

const mongoose = require('mongoose');
const PaymentIntent = require('../../models/PaymentIntent');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const User = require('../../../models/User');
const WalletTransaction = require('../../../models/WalletTransaction');
const {
  ORANGE_MERCHANT_ID,
  generateOrangeHash,
  generateTxnDate,
  callOrangeInitiateSale,
  callOrangeStatusCheck,
  verifyOrangeHash
} = require('../../helpers/orangePG.helper');

const BACKEND_URL = process.env.BACKEND_URL || 'https://amp-api.mpdreams.in/api/v1';
const FRONTEND_URL = process.env.FRONTEND_URL || 'exp://192.168.1.100:8081'; // Expo deep link

/**
 * @route POST /api/v1/ecart/user/payment/orange/initiate
 * @desc Initiate Orange PG Sale (calls Orange PG API)
 * @access Private
 */
exports.initiateOrangeSale = async (req, res) => {
  const { paymentIntentId } = req.body;
  const user = req.user;

  if (!paymentIntentId) {
    return res.status(400).json({
      success: false,
      message: 'paymentIntentId is required'
    });
  }

  try {
    // 1. Fetch PaymentIntent
    const intent = await PaymentIntent.findOne({
      _id: paymentIntentId,
      userId: user._id,
      gateway: 'orange_pg',
      status: 'created'
    });

    if (!intent) {
      return res.status(404).json({
        success: false,
        message: 'PaymentIntent not found or already processed'
      });
    }

    // 2. Check if already initiated
    if (intent.meta?.orangePG?.tranCtx) {
      const redirectURL = `${intent.meta.orangePG.redirectURI}?tranCtx=${encodeURIComponent(intent.meta.orangePG.tranCtx)}`;
      return res.status(200).json({
        success: true,
        message: 'Orange PG sale already initiated',
        data: {
          paymentIntentId: intent._id,
          redirectURL,
          tranCtx: intent.meta.orangePG.tranCtx
        }
      });
    }

    // 3. Prepare Orange PG request parameters
    const txnDate = generateTxnDate();
    
    const saleParams = {
      merchantId: ORANGE_MERCHANT_ID,
      merchantTxnNo: intent.merchantTxnNo,
      amount: intent.amount.toFixed(2),
      currencyCode: '356', // INR
      payType: '0', // Standard mode (redirect)
      customerEmailID: user.email || 'guest@phicommerce.com',
      transactionType: 'SALE',
      txnDate: txnDate,
      returnURL: `${BACKEND_URL}/ecart/user/payment/orange/callback`,
      customerMobileNo: user.phone || '9999999999',
      addlParam1: intent.referenceId.toString(), // orderId
      addlParam2: paymentIntentId.toString() // paymentIntentId
    };

    // 4. Generate secureHash
    saleParams.secureHash = generateOrangeHash(saleParams, process.env.ORANGE_MERCHANT_SECRET);

    // 5. Call Orange PG API
    const orangeResponse = await callOrangeInitiateSale(saleParams);

    // 6. Validate response
    if (orangeResponse.responseCode !== 'R1000') {
      throw new Error(orangeResponse.responseDescription || 'Orange PG initiation failed');
    }

    // 7. Update PaymentIntent with Orange PG details
    intent.meta = intent.meta || {};
    intent.meta.orangePG = {
      tranCtx: orangeResponse.tranCtx,
      redirectURI: orangeResponse.redirectURI,
      txnDate: txnDate,
      initiatedAt: new Date(),
      responseCode: orangeResponse.responseCode
    };
    await intent.save();

    // 8. Return redirect URL to frontend
    const redirectURL = `${orangeResponse.redirectURI}?tranCtx=${encodeURIComponent(orangeResponse.tranCtx)}`;

    return res.status(200).json({
      success: true,
      message: 'Orange PG sale initiated successfully',
      data: {
        paymentIntentId: intent._id,
        redirectURL,
        tranCtx: orangeResponse.tranCtx
      }
    });

  } catch (err) {
    console.error('[initiateOrangeSale] error:', err.message);
    
    // Mark intent as failed
    if (paymentIntentId) {
      await PaymentIntent.findByIdAndUpdate(paymentIntentId, {
        status: 'failed',
        'meta.orangePG.error': err.message,
        'meta.orangePG.failedAt': new Date()
      });
    }

    return res.status(500).json({
      success: false,
      message: `Orange PG initiation failed: ${err.message}`
    });
  }
};


/**
 * @route POST /api/v1/ecart/user/payment/orange/callback
 * @desc Handle Orange PG payment callback (Form POST from Orange PG)
 * @access Public (but hash verified)
 */
exports.handleOrangeCallback = async (req, res) => {
  try {
    // ============================================================
    // STEP 1: VALIDATE PAYLOAD (Defensive)
    // ============================================================
    if (!req.body || Object.keys(req.body).length === 0) {
      console.error('[Orange PG Callback] Empty payload received');
      return res.status(400).send('<h1>Bad Request - Empty Payload</h1>');
    }

    const {
      responseCode,
      respDescription,
      merchantId,
      merchantTxnNo,
      txnID,
      paymentDateTime,
      paymentID,
      amount,
      paymentMode,
      paymentSubInstType,
      addlParam1, // orderId
      addlParam2, // paymentIntentId
      secureHash
    } = req.body;

    console.log('[Orange PG Callback] Received:', {
      responseCode,
      merchantTxnNo,
      txnID,
      orderId: addlParam1,
      paymentIntentId: addlParam2,
      hasSecureHash: !!secureHash
    });

    // ============================================================
    // STEP 2: VALIDATE REQUIRED FIELDS
    // ============================================================
    const missingFields = [];
    
    if (!merchantTxnNo) missingFields.push('merchantTxnNo');
    if (!addlParam2) missingFields.push('addlParam2 (paymentIntentId)');
    if (!secureHash) missingFields.push('secureHash');
    if (!responseCode) missingFields.push('responseCode');

    if (missingFields.length > 0) {
      console.error('[Orange PG Callback] Missing required fields:', missingFields);
      return res.status(400).send(`<h1>Bad Request - Missing Fields</h1><p>Missing: ${missingFields.join(', ')}</p>`);
    }

    // ============================================================
    // STEP 3: VERIFY HASH
    // ============================================================
    let hashValid = false;
    try {
      hashValid = verifyOrangeHash(req.body, secureHash);
    } catch (hashError) {
      console.error('[Orange PG Callback] Hash verification error:', hashError.message);
      return res.status(400).send('<h1>Hash Verification Failed</h1>');
    }

    if (!hashValid) {
      console.error('[Orange PG Callback] Invalid hash!');
      console.error('[Orange PG Callback] Received hash:', secureHash.substring(0, 20) + '...');
      return res.status(400).send('<h1>Invalid Signature</h1>');
    }

    console.log('[Orange PG Callback] ✅ Hash verified successfully');

    // ============================================================
    // STEP 4: VALIDATE PAYMENT INTENT ID FORMAT
    // ============================================================
    if (!mongoose.Types.ObjectId.isValid(addlParam2)) {
      console.error('[Orange PG Callback] Invalid PaymentIntent ID format:', addlParam2);
      return res.status(400).send('<h1>Invalid Payment Intent ID</h1>');
    }

    // ============================================================
    // STEP 5: FIND PAYMENT INTENT
    // ============================================================
    let intent;
    try {
      intent = await PaymentIntent.findById(addlParam2);
    } catch (dbError) {
      console.error('[Orange PG Callback] Database error:', dbError.message);
      return res.status(500).send('<h1>Database Error</h1>');
    }

    if (!intent) {
      console.error('[Orange PG Callback] PaymentIntent not found:', addlParam2);
      return res.status(404).send('<h1>Payment Record Not Found</h1>');
    }

    console.log('[Orange PG Callback] PaymentIntent found:', {
      intentId: intent._id,
      currentStatus: intent.status,
      orderId: intent.referenceId
    });

    // ============================================================
    // STEP 6: VALIDATE MERCHANT TXN NO MATCH (Security)
    // ============================================================
    if (intent.merchantTxnNo !== merchantTxnNo) {
      console.error('[Orange PG Callback] merchantTxnNo mismatch!', {
        expected: intent.merchantTxnNo,
        received: merchantTxnNo
      });
      return res.status(400).send('<h1>Transaction Reference Mismatch</h1>');
    }

    // ============================================================
    // STEP 7: IDEMPOTENCY CHECK
    // ============================================================
    if (intent.status === 'captured') {
      console.log('[Orange PG Callback] Already processed as SUCCESS, redirecting...');
      return res.redirect(`${FRONTEND_URL}/--/success?orderId=${addlParam1 || intent.referenceId}`);
    }

    if (intent.status === 'failed') {
      console.log('[Orange PG Callback] Already processed as FAILED, redirecting...');
      return res.redirect(`${FRONTEND_URL}/--/checkout?error=payment_already_failed`);
    }

    // ============================================================
    // STEP 8: PROCESS PAYMENT RESULT
    // ============================================================
    const isSuccess = responseCode === '000' || responseCode === '0000';

    if (isSuccess) {
      // SUCCESS FLOW
      try {
        await handleOrangePaymentSuccess(intent, addlParam1 || intent.referenceId, {
          txnID: txnID || 'N/A',
          paymentID: paymentID || 'N/A',
          paymentDateTime: paymentDateTime || new Date().toISOString(),
          amount: amount ? parseFloat(amount) : intent.amount,
          paymentMode: paymentMode || 'UNKNOWN',
          paymentSubInstType: paymentSubInstType || 'UNKNOWN',
          responseCode
        });

        console.log(`[Orange PG Callback] ✅ Payment successful for Order ${addlParam1}`);
        return res.redirect(`${FRONTEND_URL}/--/success?orderId=${addlParam1 || intent.referenceId}`);

      } catch (successError) {
        console.error('[Orange PG Callback] Error in success handler:', successError.message);
        
        // Mark as failed since we couldn't process success
        await PaymentIntent.findByIdAndUpdate(addlParam2, {
          status: 'failed',
          'meta.orangePG.error': successError.message
        }).catch(() => {}); // Ignore update errors

        return res.status(500).send('<h1>Error Processing Payment Success</h1>');
      }

    } else {
      // FAILURE FLOW
      try {
        await handleOrangePaymentFailure(
          intent, 
          addlParam1 || intent.referenceId, 
          {
            responseCode,
            respDescription: respDescription || 'Payment failed'
          }
        );

        console.log(`[Orange PG Callback] ❌ Payment failed for Order ${addlParam1}`);
        return res.redirect(`${FRONTEND_URL}/--/checkout?error=${encodeURIComponent(respDescription || 'payment_failed')}`);

      } catch (failureError) {
        console.error('[Orange PG Callback] Error in failure handler:', failureError.message);
        return res.status(500).send('<h1>Error Processing Payment Failure</h1>');
      }
    }

  } catch (err) {
    // ============================================================
    // GLOBAL ERROR HANDLER
    // ============================================================
    console.error('[Orange PG Callback] Unhandled error:', err.message);
    console.error('[Orange PG Callback] Stack:', err.stack);
    
    return res.status(500).send(`<h1>Internal Server Error</h1><p>Reference: ${Date.now()}</p>`);
  }
};


/**
 * Handle successful Orange PG payment
 */
async function handleOrangePaymentSuccess(intent, orderId, paymentDetails) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Update PaymentIntent
    intent.status = 'captured';
    intent.meta.orangePG = {
      ...intent.meta.orangePG,
      txnID: paymentDetails.txnID,
      paymentID: paymentDetails.paymentID,
      paymentDateTime: paymentDetails.paymentDateTime,
      paymentMode: paymentDetails.paymentMode,
      paymentSubInstType: paymentDetails.paymentSubInstType,
      capturedAt: new Date()
    };
    await intent.save({ session });

    // Update Order
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error('Order not found');

    order.paymentStatus = 'paid';
    order.status = 'placed';
    order.paymentInfo.gateway = 'orange_pg';
    order.paymentInfo.paymentId = paymentDetails.paymentID;
    order.finalAmountPaid = paymentDetails.amount;
    order.trackingUpdates.push({
      status: 'placed',
      note: `Payment verified via Orange PG (txnID: ${paymentDetails.txnID})`
    });
    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`[Orange PG] ✅ Payment captured for Order ${orderId}, Amount: ${paymentDetails.amount}`);
    
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('[handleOrangePaymentSuccess] error:', err.message);
    throw err;
  }
}


/**
 * Handle failed Orange PG payment
 */
async function handleOrangePaymentFailure(intent, orderId, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error('Order not found');

    console.log(`[Orange PG] Processing failure for Order ${orderId}: ${reason}`);

    // Restore stock
    for (const item of order.items) {
      await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.quantity } },
        { session }
      );
    }

    // Refund wallet if used
    if (order.usedWalletAmount > 0) {
      await User.findByIdAndUpdate(
        order.buyerId,
        { $inc: { 'wallets.eCartWallet': order.usedWalletAmount } },
        { session }
      );

      await WalletTransaction.create([{
        userId: order.buyerId,
        type: 'earn',
        source: 'system',
        fromWallet: 'eCartWallet',
        amount: order.usedWalletAmount,
        status: 'success',
        triggeredBy: 'system',
        notes: `Refund - Orange PG payment failed: ${reason}`
      }], { session });
    }

    // Update Order
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.trackingUpdates.push({
      status: 'cancelled',
      note: `Orange PG payment failed: ${reason}`
    });
    await order.save({ session });

    // Update PaymentIntent
    intent.status = 'failed';
    intent.meta.orangePG = {
      ...intent.meta.orangePG,
      failedAt: new Date(),
      failureReason: reason
    };
    await intent.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`[Orange PG] ❌ Payment failed, rollback completed for Order ${orderId}`);
    
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('[handleOrangePaymentFailure] error:', err.message);
    throw err;
  }
}


/**
 * @route GET /api/v1/ecart/user/payment/orange/verify/:paymentIntentId
 * @desc Verify Orange PG payment status (for polling)
 * @access Private
 */
exports.verifyOrangePaymentStatus = async (req, res) => {
  const { paymentIntentId } = req.params;
  const user = req.user;

  try {
    // 1. Find PaymentIntent
    const intent = await PaymentIntent.findOne({
      _id: paymentIntentId,
      userId: user._id,
      gateway: 'orange_pg'
    });

    if (!intent) {
      return res.status(404).json({
        success: false,
        message: 'PaymentIntent not found'
      });
    }

    // 2. If already processed, return status
    if (intent.status === 'captured') {
      return res.status(200).json({
        success: true,
        decision: 'SUCCESS',
        status: 'captured',
        orderId: intent.referenceId,
        message: 'Payment already verified'
      });
    }

    if (intent.status === 'failed') {
      return res.status(200).json({
        success: true,
        decision: 'FAIL',
        status: 'failed',
        orderId: intent.referenceId,
        message: 'Payment already marked as failed'
      });
    }

    // 3. Call Orange PG status check API
    const statusData = await callOrangeStatusCheck(intent.merchantTxnNo);

    // 4. Determine decision based on response
    let decision = 'WAIT';
    let shouldUpdate = false;

    if (statusData.txnStatus === 'SUC' && ['000', '0000'].includes(statusData.txnResponseCode)) {
      decision = 'SUCCESS';
      shouldUpdate = true;
      
      // Update as success
      await handleOrangePaymentSuccess(intent, intent.referenceId, {
        txnID: statusData.txnID,
        paymentID: statusData.txnAuthID,
        paymentDateTime: statusData.paymentDateTime,
        amount: intent.amount
      });
      
    } else if (['REJ', 'ERR'].includes(statusData.txnStatus)) {
      decision = 'FAIL';
      shouldUpdate = true;
      
      // Update as failure
      await handleOrangePaymentFailure(
        intent, 
        intent.referenceId, 
        statusData.txnRespDescription || 'Payment failed'
      );
    }

    return res.status(200).json({
      success: true,
      decision,
      status: shouldUpdate ? (decision === 'SUCCESS' ? 'captured' : 'failed') : intent.status,
      txnStatus: statusData.txnStatus,
      txnResponseCode: statusData.txnResponseCode,
      orderId: intent.referenceId,
      message: decision === 'SUCCESS' ? 'Payment verified' : 
               decision === 'FAIL' ? 'Payment failed' : 
               'Payment still pending'
    });

  } catch (err) {
    console.error('[verifyOrangePaymentStatus] error:', err.message);
    return res.status(500).json({
      success: false,
      decision: 'WAIT',
      message: 'Failed to verify payment status',
      error: err.message
    });
  }
};


/**
 * @route POST /api/v1/ecart/user/payment/orange/paymentadvice
 * @desc Handle Orange PG Payment Advice (Webhook)
 * @access Public (hash verified)
 */
exports.handlePaymentAdvice = async (req, res) => {
  try {
    // ============================================================
    // STEP 1: VALIDATE PAYLOAD
    // ============================================================
    if (!req.body || Object.keys(req.body).length === 0) {
      console.error('[Payment Advice] Empty payload received');
      return res.status(400).json({ 
        success: false, 
        message: 'Empty payload' 
      });
    }

    console.log('[Orange PG Payment Advice] Received:', req.body);

    const {
      responseCode,
      merchantTxnNo,
      txnID,
      paymentID,
      addlParam1, // orderId
      addlParam2, // paymentIntentId
      secureHash
    } = req.body;

    // ============================================================
    // STEP 2: VALIDATE REQUIRED FIELDS
    // ============================================================
    const missingFields = [];
    
    if (!merchantTxnNo) missingFields.push('merchantTxnNo');
    if (!addlParam2) missingFields.push('addlParam2');
    if (!secureHash) missingFields.push('secureHash');
    if (!responseCode) missingFields.push('responseCode');

    if (missingFields.length > 0) {
      console.error('[Payment Advice] Missing required fields:', missingFields);
      return res.status(400).json({ 
        success: false, 
        message: `Missing fields: ${missingFields.join(', ')}` 
      });
    }

    // ============================================================
    // STEP 3: VERIFY HASH
    // ============================================================
    let hashValid = false;
    try {
      hashValid = verifyOrangeHash(req.body, secureHash);
    } catch (hashError) {
      console.error('[Payment Advice] Hash verification error:', hashError.message);
      return res.status(400).json({ 
        success: false, 
        message: 'Hash verification failed' 
      });
    }

    if (!hashValid) {
      console.error('[Payment Advice] Invalid hash!');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid signature' 
      });
    }

    console.log('[Payment Advice] ✅ Hash verified');

    // ============================================================
    // STEP 4: VALIDATE PAYMENT INTENT ID FORMAT
    // ============================================================
    if (!mongoose.Types.ObjectId.isValid(addlParam2)) {
      console.error('[Payment Advice] Invalid PaymentIntent ID format:', addlParam2);
      return res.status(200).json({ 
        success: true, 
        message: 'Invalid ID format (ignored)' 
      });
    }

    // ============================================================
    // STEP 5: FIND PAYMENT INTENT
    // ============================================================
    let intent;
    try {
      intent = await PaymentIntent.findById(addlParam2);
    } catch (dbError) {
      console.error('[Payment Advice] Database error:', dbError.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Database error' 
      });
    }

    if (!intent) {
      console.warn('[Payment Advice] PaymentIntent not found:', addlParam2);
      // Return 200 to prevent retries from Orange PG
      return res.status(200).json({ 
        success: true, 
        message: 'Intent not found (ignored)' 
      });
    }

    console.log('[Payment Advice] PaymentIntent found:', {
      intentId: intent._id,
      currentStatus: intent.status
    });

    // ============================================================
    // STEP 6: IDEMPOTENCY CHECK
    // ============================================================
    if (intent.status === 'captured' || intent.status === 'failed') {
      console.log('[Payment Advice] Already processed, ignoring...');
      return res.status(200).json({ 
        success: true, 
        message: 'Already processed' 
      });
    }

    // ============================================================
    // STEP 7: PROCESS ADVICE
    // ============================================================
    const isSuccess = responseCode === '000' || responseCode === '0000';

    try {
      if (isSuccess) {
        await handleOrangePaymentSuccess(intent, addlParam1 || intent.referenceId, {
          txnID: txnID || 'N/A',
          paymentID: paymentID || 'N/A',
          paymentDateTime: req.body.paymentDateTime || new Date().toISOString(),
          amount: req.body.amount ? parseFloat(req.body.amount) : intent.amount,
          paymentMode: req.body.paymentMode || 'UNKNOWN',
          paymentSubInstType: req.body.paymentSubInstType || 'UNKNOWN',
          responseCode
        });

        console.log('[Payment Advice] ✅ Payment marked as success');
      } else {
        await handleOrangePaymentFailure(
          intent, 
          addlParam1 || intent.referenceId, 
          {
            responseCode,
            respDescription: req.body.respDescription || 'Payment failed'
          }
        );

        console.log('[Payment Advice] ❌ Payment marked as failed');
      }

      return res.status(200).json({ success: true });

    } catch (processError) {
      console.error('[Payment Advice] Processing error:', processError.message);
      return res.status(500).json({ 
        success: false, 
        message: 'Processing error' 
      });
    }

  } catch (err) {
    // ============================================================
    // GLOBAL ERROR HANDLER
    // ============================================================
    console.error('[Payment Advice] Unhandled error:', err.message);
    console.error('[Payment Advice] Stack:', err.stack);
    
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
};


// ================================================================
// Export all controllers
// ================================================================

module.exports = {
  initiateOrangeSale: exports.initiateOrangeSale,
  handleOrangeCallback: exports.handleOrangeCallback,
  verifyOrangePaymentStatus: exports.verifyOrangePaymentStatus,
  handlePaymentAdvice: exports.handlePaymentAdvice
};