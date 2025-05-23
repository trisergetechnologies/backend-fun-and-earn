const connectDB = require('./config/db');
const createApp = require('./app');
const { swaggerSetup } = require('./config/swagger');
const dotenv = require('dotenv');
dotenv.config(); // Load environment variables from .env file
const port = process.env.PORT;


// Create Express application
const app = createApp();

// Connect to database before starting server
connectDB()
  .then(() => {
    // Start listening for requests after DB connection is established
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
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