/**
 * Express Application Setup
 * 
 * Creates and configures the Express application with common middleware.
 * This setup is environment-agnostic - same for dev, prod, and test.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const router = require('./routes');
const path = require('path');
const { paymentWebhook } = require('./eCart/controllers/user/payment.controller.user.js');
require('./jobs/walletTransfer.js')

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
  
  // Enable CORS (configure properly for production)
  app.use(cors());
  
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
      timestamp: new Date().toISOString()
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