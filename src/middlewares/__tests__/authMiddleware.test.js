const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_auth_middleware';

const mockPopulate = jest.fn();
const mockFindById = jest.fn(() => ({ populate: mockPopulate }));

jest.mock('../../models/User', () => ({
  findById: (...args) => mockFindById(...args),
}));

const authMiddleware = require('../../middlewares/authMiddleware');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('authMiddleware token types', () => {
  const userId = '507f1f77bcf86cd799439011';
  const secret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('accepts session token when Bearer matches user.token', async () => {
    const sessionToken = jwt.sign({ userId, role: 'user', type: 'session' }, secret, {
      expiresIn: '15d',
    });
    const user = {
      _id: userId,
      role: 'user',
      isActive: true,
      token: sessionToken,
      refreshTokenHash: 'abc',
    };
    mockPopulate.mockResolvedValue(user);

    const req = { headers: { authorization: `Bearer ${sessionToken}` } };
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(['user'])(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBe(user);
  });

  test('accepts legacy token without type when Bearer matches user.token', async () => {
    const legacyToken = jwt.sign({ userId, role: 'user' }, secret, { expiresIn: '15d' });
    const user = {
      _id: userId,
      role: 'user',
      isActive: true,
      token: legacyToken,
      refreshTokenHash: null,
    };
    mockPopulate.mockResolvedValue(user);

    const req = { headers: { authorization: `Bearer ${legacyToken}` } };
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(['user'])(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('accepts access token when refreshTokenHash is present', async () => {
    const accessToken = jwt.sign({ userId, role: 'user', type: 'access' }, secret, {
      expiresIn: '1h',
    });
    const user = {
      _id: userId,
      role: 'user',
      isActive: true,
      token: 'session-elsewhere',
      refreshTokenHash: 'hash',
    };
    mockPopulate.mockResolvedValue(user);

    const req = { headers: { authorization: `Bearer ${accessToken}` } };
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(['user'])(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBe(user);
  });

  test('rejects access token when session revoked (no refreshTokenHash)', async () => {
    const accessToken = jwt.sign({ userId, role: 'user', type: 'access' }, secret, {
      expiresIn: '1h',
    });
    const user = {
      _id: userId,
      role: 'user',
      isActive: true,
      token: null,
      refreshTokenHash: null,
    };
    mockPopulate.mockResolvedValue(user);

    const req = { headers: { authorization: `Bearer ${accessToken}` } };
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(['user'])(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Unauthorized: Session expired' })
    );
  });

  test('rejects refresh token on API routes', async () => {
    const refreshToken = jwt.sign({ userId, role: 'user', type: 'refresh' }, secret, {
      expiresIn: '30d',
    });

    const req = { headers: { authorization: `Bearer ${refreshToken}` } };
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(['user'])(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockFindById).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
