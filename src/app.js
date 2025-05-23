/**
 * Express Application Setup
 * 
 * Creates and configures the Express application with common middleware.
 * This setup is environment-agnostic - same for dev, prod, and test.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const commonRouter = require('./routes');

/**
 * Creates a new Express application with base configuration
 * 
 * @returns {express.Application} Configured Express application
 */
const createApp = () => {
  // Initialize Express application
  const app = express();
  
  // ======================
  // Essential Middleware
  // ======================
  
  // Security headers
  app.use(helmet());
  
  // Enable CORS (configure properly for production)
  app.use(cors());
  
  // Parse JSON bodies
  app.use(express.json());
  
  // Parse URL-encoded bodies
  app.use(express.urlencoded({ extended: true }));
  
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
  app.use('/api/v1', commonRouter);


  return app;
};

module.exports = createApp;