const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config(); // Load environment variables from .env file

const connectDB = async () => {
  try {
    // Check if MONGO_URI is set in environment variables
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not set in environment variables');
    }
    const mongoURI = process.env.MONGO_URI;

    await mongoose.connect(mongoURI); // No extra options needed in v7+

    console.log(`✅ MongoDB connected to: ${mongoose.connection.host}`);
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
