const axios = require('axios');

const BASE_URL = (process.env.AUTOPOOL_E2E_BASE_URL || process.env.BACKEND_URL || 'http://localhost:5000/api/v1').replace(
  /\/$/,
  ''
);

function createClient() {
  return axios.create({
    baseURL: BASE_URL,
    validateStatus: () => true,
    timeout: 60000,
  });
}

async function login(http, email, password, loginApp = 'eCart') {
  const res = await http.post('/auth/login', { email, password, loginApp });
  if (!res.data?.success) {
    throw new Error(`Login failed for ${email}: ${res.data?.message || res.status}`);
  }
  const token = res.data.data.accessToken || res.data.data.token;
  return { token, user: res.data.data.user || res.data.data };
}

function withAuth(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  BASE_URL,
  createClient,
  login,
  withAuth,
};
