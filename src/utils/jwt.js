const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

/** Temporary short TTL for refresh testing — restore to '1h' / 3600 before prod. */
const ACCESS_TOKEN_TTL = '2m';
const ACCESS_TOKEN_EXPIRES_IN_SEC = 120;
const REFRESH_TOKEN_TTL = '30d';
const SESSION_TOKEN_TTL = '15d';

/** Long-lived session JWT for legacy clients / Admin (`data.token`). */
const generateToken = (payload, expiresIn = SESSION_TOKEN_TTL) => {
  return jwt.sign({ ...payload, type: 'session' }, JWT_SECRET, { expiresIn });
};

/** Short-lived access JWT for updated mobile apps. */
const generateAccessToken = (payload, expiresIn = ACCESS_TOKEN_TTL) => {
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn });
};

/** Long-lived refresh JWT; only valid on POST /auth/refresh. */
const generateRefreshToken = (payload, expiresIn = REFRESH_TOKEN_TTL) => {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn });
};

const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  ACCESS_TOKEN_EXPIRES_IN_SEC,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  SESSION_TOKEN_TTL,
};
