/**
 * Express Application Setup
 * 
 * Creates and configures the Express application with common middleware.
 * This setup is environment-agnostic - same for dev, prod, and test.
 */
const mongoose = require('mongoose');
const os = require('os');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const router = require('./routes');
const path = require('path');
const { paymentWebhook } = require('./eCart/controllers/user/payment.controller.user.js');
// require('./jobs/walletTransfer.js')
// require('./jobs/reconcileRazorpayPayments.js')
// require('./jobs/packageBuyCron.js')

try {
  require('./jobs/walletTransfer');
  console.log('walletTransfer loaded');
} catch (e) {
  console.error('walletTransfer failed', e);
}

try {
  require('./jobs/reconcileRazorpayPayments');
  console.log('reconcileRazorpayPayments loaded');
} catch (e) {
  console.error('reconcileRazorpayPayments failed', e);
}

try {
  require('./jobs/packageBuyCron');
  console.log('packageBuyCron loaded');
} catch (e) {
  console.error('packageBuyCron failed', e);
}

/**
 * Creates a new Express application with base configuration
 * 
 * @returns {express.Application} Configured Express application
 */
const createApp = () => {
  // Initialize Express application
  const app = express();


  // Razorpay Webhook (public — Razorpay server calls this)
  app.post(
    '/api/payment/webhook',
    express.raw({ type: 'application/json' }),
    paymentWebhook
  );


  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  app.use('/invoices', express.static(path.join(__dirname, '../invoices')));
  app.set('trust proxy', true);
  // ======================
  // Essential Middleware
  // ======================
  
  // Security headers
  app.use(helmet());
  
  // Enable CORS — expose Content-Disposition so browsers allow reading download filenames (cross-origin).
  app.use(
    cors({
      exposedHeaders: ['Content-Disposition'],
    })
  );
  
  // Parse JSON bodies
  app.use(express.json({limit: "50mb"}));
  
  // Parse URL-encoded bodies
  app.use(express.urlencoded({ limit: "50mb",extended: true }));
  
  // ======================
  // Health Check Route
  // ======================
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),

      process: {
        pid: process.pid,
        uptimeSeconds: process.uptime(),
        nodeVersion: process.version,
        env: process.env.NODE_ENV || 'undefined'
      },

      memory: {
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },

      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        cpuLoad: os.loadavg()
      },

      mongodb: {
        state: mongoose.connection.readyState, // 1 = connected
        host: mongoose.connection.host,
        name: mongoose.connection.name
      },

      crons: global.__CRON_DEBUG__,

      envVarsPresent: {
        RAZORPAY_KEY_ID: !!process.env.RAZORPAY_KEY_ID,
        RAZORPAY_SECRET: !!process.env.RAZORPAY_SECRET,
        MONGO_URI: !!process.env.MONGO_URI
      }
    });
  });

  // ======================
  // API Routes
  // ======================
  // Import routes
  app.use('/api/v1', router);


  return app;
};

module.exports = createApp;