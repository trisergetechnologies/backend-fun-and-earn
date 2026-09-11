class AssertError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'AssertError';
    this.meta = meta;
  }
}

function expect(condition, message, meta) {
  if (!condition) throw new AssertError(message, meta);
}

function expectEq(actual, expected, label) {
  if (actual !== expected) {
    throw new AssertError(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, {
      actual,
      expected,
      label,
    });
  }
}

function expectStatus(res, status, label = 'status') {
  expectEq(res.status, status, label);
}

function expectCode(res, code) {
  expectEq(res.data?.code, code, 'error code');
}

function expectApprox(actual, expected, label, eps = 0.01) {
  if (Math.abs(Number(actual) - Number(expected)) > eps) {
    throw new AssertError(`${label}: expected ~${expected}, got ${actual}`);
  }
}

module.exports = {
  AssertError,
  expect,
  expectEq,
  expectStatus,
  expectCode,
  expectApprox,
};
