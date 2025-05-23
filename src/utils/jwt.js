const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config(); // Load environment variables from .env file

const JWT_SECRET = process.env.JWT_SECRET;

// Generate token using payload (userId, role)
const generateToken = (payload, expiresIn = '15d') => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

module.exports = {
  generateToken
};

