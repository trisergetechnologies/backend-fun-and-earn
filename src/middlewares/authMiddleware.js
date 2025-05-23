// common/middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_key';

/**
 * Middleware to protect routes based on user roles.
 * @param {Array} allowedRoles - Array of allowed roles like ['admin', 'seller']
 */
const authMiddleware = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: No token provided',
          data: null
        });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized: Invalid user',
          data: null
        });
      }

      // Attach user to request for downstream use
      req.user = user;

      // Check role if restriction exists
      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Insufficient permissions',
          data: null
        });
      }

      next();
    } catch (err) {
      console.error('Auth Middleware Error:', err);
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Invalid or expired token',
        data: null
      });
    }
  };
};

module.exports = authMiddleware;
