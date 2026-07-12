const crypto = require('crypto');
const {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  ACCESS_TOKEN_EXPIRES_IN_SEC,
} = require('./jwt');

function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(String(refreshToken)).digest('hex');
}

/**
 * Issue session (legacy), access, and refresh tokens for a user.
 * Session token continues to power Admin / old apps via `data.token`.
 */
function issueAuthTokens(user) {
  const payload = { userId: user._id.toString(), role: user.role };
  const sessionToken = generateToken(payload);
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  return {
    sessionToken,
    accessToken,
    refreshToken,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresIn: ACCESS_TOKEN_EXPIRES_IN_SEC,
  };
}

function applyAuthTokensToUser(user, tokens) {
  user.token = tokens.sessionToken;
  user.refreshTokenHash = tokens.refreshTokenHash;
}

function clearAuthTokensOnUser(user) {
  user.token = null;
  user.refreshTokenHash = null;
}

function authTokensResponseData(tokens, userPayload) {
  return {
    token: tokens.sessionToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: userPayload,
  };
}

module.exports = {
  hashRefreshToken,
  issueAuthTokens,
  applyAuthTokensToUser,
  clearAuthTokensOnUser,
  authTokensResponseData,
};
