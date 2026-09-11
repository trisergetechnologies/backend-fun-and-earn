const cron = require('node-cron');
const User = require('../models/User');
const { default: axios } = require('axios');
require('dotenv').config({ override: true });

cron.schedule('0 6 * * *', async () => {
  try {
    console.log('📡 Running cron job at 6:00 AM IST');

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    const base = (process.env.BACKEND_URL || 'http://localhost:5000/api/v1').replace(
      /\/$/,
      ''
    );
    const URL = `${base}/shortvideo/admin/transfershortvideotoecart`;

    const admin = await User.findOne({ email: ADMIN_EMAIL });
    const token = admin?.token;

    const response = await axios.put(
      URL,
      {},
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10 * 60 * 1000 }
    );

    console.log('✅ API Response Success:', response.data.success);
  } catch (error) {
    console.error('❌ API call failed:', error.message);
  }
}, {
  timezone: 'Asia/Kolkata',
});
