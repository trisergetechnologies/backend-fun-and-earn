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
  rotateRefreshSession,
  hasActiveRefreshSession,
  revokeRefreshSession,
  MAX_REFRESH_SESSIONS,
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

  test('issueAuthTokens returns session, access, refresh, sid and hash', () => {
    const user = { _id: payload.userId, role: 'user' };
    const tokens = issueAuthTokens(user);

    expect(tokens.sessionToken).toBeTruthy();
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.sessionId).toBeTruthy();
    expect(tokens.refreshTokenHash).toBe(hashRefreshToken(tokens.refreshToken));
    expect(tokens.expiresIn).toBe(120);

    expect(verifyToken(tokens.sessionToken).type).toBe('session');
    expect(verifyToken(tokens.accessToken).type).toBe('access');
    const refreshDecoded = verifyToken(tokens.refreshToken);
    expect(refreshDecoded.type).toBe('refresh');
    expect(refreshDecoded.sid).toBe(tokens.sessionId);
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

  test('applyAuthTokensToUser adds a session without wiping others', () => {
    const user = { _id: payload.userId, role: 'user', refreshSessions: [] };
    const tokensA = issueAuthTokens(user, { app: 'eCart' });
    applyAuthTokensToUser(user, tokensA, { app: 'eCart' });
    expect(user.token).toBe(tokensA.sessionToken);
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshTokenHash).toBe(tokensA.refreshTokenHash);

    const tokensB = issueAuthTokens(user, { app: 'shortVideo' });
    applyAuthTokensToUser(user, tokensB, { app: 'shortVideo' });
    expect(user.refreshSessions).toHaveLength(2);
    expect(user.refreshSessions.map((s) => s.app).sort()).toEqual(['eCart', 'shortVideo']);
    expect(hasActiveRefreshSession(user)).toBe(true);
  });

  test('clearAuthTokensOnUser clears sessions and legacy fields', () => {
    const user = { _id: payload.userId, role: 'user', refreshSessions: [] };
    const tokens = issueAuthTokens(user);
    applyAuthTokensToUser(user, tokens);
    clearAuthTokensOnUser(user);
    expect(user.token).toBeNull();
    expect(user.refreshTokenHash).toBeNull();
    expect(user.refreshSessions).toEqual([]);
    expect(hasActiveRefreshSession(user)).toBe(false);
  });

  test('rotateRefreshSession only rotates the matching session', () => {
    const user = { _id: payload.userId, role: 'user', refreshSessions: [] };
    const tokensA = issueAuthTokens(user, { app: 'eCart' });
    applyAuthTokensToUser(user, tokensA, { app: 'eCart' });
    const tokensB = issueAuthTokens(user, { app: 'shortVideo' });
    applyAuthTokensToUser(user, tokensB, { app: 'shortVideo' });

    const hashABefore = user.refreshSessions.find((s) => s.app === 'eCart').tokenHash;
    const decodedB = verifyToken(tokensB.refreshToken);
    const rotated = rotateRefreshSession(user, tokensB.refreshToken, decodedB);

    expect(rotated).toBeTruthy();
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).toBeTruthy();
    expect(user.refreshSessions).toHaveLength(2);

    const eCartSession = user.refreshSessions.find((s) => s.app === 'eCart');
    const reelsSession = user.refreshSessions.find((s) => s.app === 'shortVideo');
    expect(eCartSession.tokenHash).toBe(hashABefore);
    expect(reelsSession.tokenHash).toBe(hashRefreshToken(rotated.refreshToken));
    expect(reelsSession.tokenHash).not.toBe(tokensB.refreshTokenHash);

    // Old Reels refresh no longer works; Mart refresh still does
    expect(rotateRefreshSession(user, tokensB.refreshToken, decodedB)).toBeNull();
    const decodedA = verifyToken(tokensA.refreshToken);
    expect(rotateRefreshSession(user, tokensA.refreshToken, decodedA)).toBeTruthy();
  });

  test('rotateRefreshSession migrates legacy single refreshTokenHash', () => {
    const user = {
      _id: payload.userId,
      role: 'user',
      refreshSessions: [],
    };
    const refreshToken = generateRefreshToken(payload);
    user.refreshTokenHash = hashRefreshToken(refreshToken);

    const decoded = verifyToken(refreshToken);
    const rotated = rotateRefreshSession(user, refreshToken, decoded);
    expect(rotated).toBeTruthy();
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshSessions[0].tokenHash).toBe(hashRefreshToken(rotated.refreshToken));
  });

  test('revokeRefreshSession removes only one session', () => {
    const user = { _id: payload.userId, role: 'user', refreshSessions: [] };
    const tokensA = issueAuthTokens(user);
    applyAuthTokensToUser(user, tokensA, { app: 'eCart' });
    const tokensB = issueAuthTokens(user);
    applyAuthTokensToUser(user, tokensB, { app: 'shortVideo' });

    expect(revokeRefreshSession(user, tokensA.refreshToken)).toBe(true);
    expect(user.refreshSessions).toHaveLength(1);
    expect(user.refreshSessions[0].tokenHash).toBe(tokensB.refreshTokenHash);
  });

  test('caps refresh sessions at MAX_REFRESH_SESSIONS', () => {
    const user = { _id: payload.userId, role: 'user', refreshSessions: [] };
    for (let i = 0; i < MAX_REFRESH_SESSIONS + 3; i++) {
      const tokens = issueAuthTokens(user);
      applyAuthTokensToUser(user, tokens);
    }
    expect(user.refreshSessions.length).toBe(MAX_REFRESH_SESSIONS);
  });

  test('legacy JWT without type still verifies', () => {
    const legacy = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15d' });
    const decoded = verifyToken(legacy);
    expect(decoded.type).toBeUndefined();
    expect(decoded.userId).toBe(payload.userId);
  });
});
