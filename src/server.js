const connectDB = require('./config/db');
const createApp = require('./app');
const { swaggerSetup } = require('./config/swagger');
const dotenv = require('dotenv');
// .env must win over machine-level BACKEND_URL etc. during local/ngrok dev
dotenv.config({ override: true });
const port = process.env.PORT;


// Create Express application
const app = createApp();

// Connect to database before starting server
connectDB()
  .then(() => {
    // Start listening for requests after DB connection is established
    const server = app.listen(port, () => {
      const backendUrl = (process.env.BACKEND_URL || '').replace(/\/$/, '');
      console.log(`Server running on port ${port}`);
      if (backendUrl) {
        console.log(`BACKEND_URL=${backendUrl}`);
        console.log(`CCAvenue callback=${backendUrl}/public/ccavenue/callback`);
        console.log(`CCAvenue cancel=${backendUrl}/public/ccavenue/cancel`);
      }
    });

    swaggerSetup(app);
    
    // ======================
    // Graceful Shutdown
    // ======================
    
    // Handle SIGTERM (for Docker, Kubernetes, etc.)
    process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      console.error('Unhandled Rejection:', err);
      server.close(() => process.exit(1));
    });
  })
  .catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

// Export server for testing purposes
module.exports = app;