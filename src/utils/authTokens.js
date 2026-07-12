const crypto = require('crypto');
const {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  ACCESS_TOKEN_EXPIRES_IN_SEC,
} = require('./jwt');

/** Max concurrent refresh sessions per user (Mart + Reels + Admin + devices). */
const MAX_REFRESH_SESSIONS = 10;
/** Align with REFRESH_TOKEN_TTL ('7d'). */
const REFRESH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(String(refreshToken)).digest('hex');
}

function newSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function ensureRefreshSessions(user) {
  if (!Array.isArray(user.refreshSessions)) {
    user.refreshSessions = [];
  }
  return user.refreshSessions;
}

function pruneExpiredRefreshSessions(user, now = Date.now()) {
  const sessions = ensureRefreshSessions(user);
  const next = sessions.filter((s) => {
    if (!s || !s.tokenHash) return false;
    if (!s.expiresAt) return true;
    return new Date(s.expiresAt).getTime() > now;
  });
  if (next.length !== sessions.length) {
    user.refreshSessions = next;
  }
  return user.refreshSessions;
}

/** True if the user still has any usable refresh session (multi or legacy). */
function hasActiveRefreshSession(user) {
  if (!user) return false;
  const sessions = pruneExpiredRefreshSessions(user);
  if (sessions.length > 0) return true;
  return Boolean(user.refreshTokenHash);
}

/**
 * Issue session (legacy), access, and refresh tokens for a user.
 * Refresh JWT includes `sid` for multi-session lookup (clients treat it as opaque).
 */
function issueAuthTokens(user, options = {}) {
  const payload = { userId: user._id.toString(), role: user.role };
  const sessionId = newSessionId();
  const sessionToken = generateToken(payload);
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken({ ...payload, sid: sessionId });

  return {
    sessionId,
    sessionToken,
    accessToken,
    refreshToken,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresIn: ACCESS_TOKEN_EXPIRES_IN_SEC,
    app: options.app || null,
  };
}

/**
 * Persist a new refresh session without invalidating other devices/apps.
 * Also updates legacy `token` + `refreshTokenHash` (latest) for older code paths.
 */
function applyAuthTokensToUser(user, tokens, options = {}) {
  user.token = tokens.sessionToken;

  const sessions = pruneExpiredRefreshSessions(user);
  const now = new Date();
  sessions.push({
    id: tokens.sessionId,
    tokenHash: tokens.refreshTokenHash,
    app: options.app != null ? options.app : tokens.app || null,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_SESSION_TTL_MS),
  });

  while (sessions.length > MAX_REFRESH_SESSIONS) {
    sessions.shift();
  }

  user.refreshSessions = sessions;
  // Keep legacy field non-null while any session exists (access middleware BC).
  user.refreshTokenHash = tokens.refreshTokenHash;

  if (typeof user.markModified === 'function') {
    user.markModified('refreshSessions');
  }
}

function clearAuthTokensOnUser(user) {
  user.token = null;
  user.refreshTokenHash = null;
  user.refreshSessions = [];
  if (typeof user.markModified === 'function') {
    user.markModified('refreshSessions');
  }
}

/**
 * Find the session for an incoming refresh token and rotate it in place.
 * Supports:
 * - multi-session list (by sid and/or hash)
 * - legacy single `refreshTokenHash`
 *
 * @returns {{ accessToken: string, refreshToken: string, expiresIn: number } | null}
 */
function rotateRefreshSession(user, refreshToken, decoded) {
  const incomingHash = hashRefreshToken(refreshToken);
  const sessions = pruneExpiredRefreshSessions(user);
  const now = new Date();

  let idx = -1;
  if (decoded && decoded.sid) {
    idx = sessions.findIndex(
      (s) => s.id === decoded.sid && s.tokenHash === incomingHash
    );
  }
  if (idx < 0) {
    idx = sessions.findIndex((s) => s.tokenHash === incomingHash);
  }

  // Legacy: single hash, no sessions yet — migrate into multi-session.
  if (idx < 0 && user.refreshTokenHash && user.refreshTokenHash === incomingHash) {
    const sessionId = (decoded && decoded.sid) || newSessionId();
    sessions.push({
      id: sessionId,
      tokenHash: incomingHash,
      app: null,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_SESSION_TTL_MS),
    });
    idx = sessions.length - 1;
  }

  if (idx < 0) return null;

  const payload = { userId: user._id.toString(), role: user.role || decoded.role };
  const nextSessionId = newSessionId();
  const accessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken({ ...payload, sid: nextSessionId });
  const newHash = hashRefreshToken(newRefreshToken);

  const prev = sessions[idx];
  sessions[idx] = {
    id: nextSessionId,
    tokenHash: newHash,
    app: prev.app || null,
    createdAt: prev.createdAt || now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + REFRESH_SESSION_TTL_MS),
  };

  user.refreshSessions = sessions;
  user.refreshTokenHash = newHash;
  if (typeof user.markModified === 'function') {
    user.markModified('refreshSessions');
  }

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN_SEC,
  };
}

/**
 * Revoke one refresh session (this device). Returns true if a session was removed.
 */
function revokeRefreshSession(user, refreshToken) {
  const incomingHash = hashRefreshToken(refreshToken);
  const sessions = pruneExpiredRefreshSessions(user);
  const next = sessions.filter((s) => s.tokenHash !== incomingHash);
  const removed = next.length !== sessions.length;

  if (removed) {
    user.refreshSessions = next;
    user.refreshTokenHash = next.length ? next[next.length - 1].tokenHash : null;
    if (typeof user.markModified === 'function') {
      user.markModified('refreshSessions');
    }
  } else if (user.refreshTokenHash === incomingHash) {
    user.refreshTokenHash = null;
    return true;
  }

  return removed;
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
  hasActiveRefreshSession,
  rotateRefreshSession,
  revokeRefreshSession,
  pruneExpiredRefreshSessions,
  ensureRefreshSessions,
  MAX_REFRESH_SESSIONS,
  REFRESH_SESSION_TTL_MS,
};
