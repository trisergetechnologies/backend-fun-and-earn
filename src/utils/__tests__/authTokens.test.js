const jwt = require('jsonwebtoken');
const {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
} = require('../jwt');
const {
  hashRefreshToken,
  issueAuthTokens,
  applyAuthTokensToUser,
  clearAuthTokensOnUser,
  authTokensResponseData,
} = require('../authTokens');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_auth_tokens';

describe('auth token helpers', () => {
  const payload = { userId: '507f1f77bcf86cd799439011', role: 'user' };

  test('generateToken issues session-type JWT', () => {
    const token = generateToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.type).toBe('session');
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.role).toBe('user');
  });

  test('generateAccessToken issues access-type JWT', () => {
    const token = generateAccessToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.type).toBe('access');
  });

  test('generateRefreshToken issues refresh-type JWT', () => {
    const token = generateRefreshToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.type).toBe('refresh');
  });

  test('issueAuthTokens returns session, access, refresh and hash', () => {
    const user = { _id: payload.userId, role: 'user' };
    const tokens = issueAuthTokens(user);

    expect(tokens.sessionToken).toBeTruthy();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.refreshTokenHash).toBe(hashRefreshToken(tokens.refreshToken));
    expect(tokens.expiresIn).toBe(120);

    expect(verifyToken(tokens.sessionToken).type).toBe('session');
    expect(verifyToken(tokens.accessToken).type).toBe('access');
    expect(verifyToken(tokens.refreshToken).type).toBe('refresh');
  });

  test('authTokensResponseData keeps data.token as session for BC', () => {
    const user = { _id: payload.userId, role: 'user' };
    const tokens = issueAuthTokens(user);
    const data = authTokensResponseData(tokens, { id: payload.userId, name: 'Test' });

    expect(data.token).toBe(tokens.sessionToken);
    expect(data.accessToken).toBe(tokens.accessToken);
    expect(data.refreshToken).toBe(tokens.refreshToken);
    expect(data.user.name).toBe('Test');
  });

  test('applyAuthTokensToUser and clearAuthTokensOnUser', () => {
    const user = { _id: payload.userId, role: 'user' };
    const tokens = issueAuthTokens(user);
    applyAuthTokensToUser(user, tokens);
    expect(user.token).toBe(tokens.sessionToken);
    expect(user.refreshTokenHash).toBe(tokens.refreshTokenHash);

    clearAuthTokensOnUser(user);
    expect(user.token).toBeNull();
    expect(user.refreshTokenHash).toBeNull();
  });

  test('legacy JWT without type still verifies', () => {
    const legacy = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15d' });
    const decoded = verifyToken(legacy);
    expect(decoded.type).toBeUndefined();
    expect(decoded.userId).toBe(payload.userId);
  });
});
