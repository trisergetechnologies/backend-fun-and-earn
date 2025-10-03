const cron = require('node-cron');
const User = ('../models/User');
const { default: axios } = require('axios');
require('dotenv').config();


cron.schedule('0 6 * * *', async () => {
  try {
    console.log('📡 Running cron job at 6:00 AM IST');
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL

    const admin = await User.findOne({email: ADMIN_EMAIL});
    const URL = 'https://amp-api.mpdreams.in/api/v1/shortvideo/admin/transfershortvideotoecart';
    const token = admin?.token;

    const response = await axios.put(URL, {}, {headers: {Authorization: `Bearer ${token}`}});

    console.log('✅ API Response Success:', response.data.success);
  } catch (error) {
    console.error('❌ API call failed:', error.message);
  }
}, {
  timezone: 'Asia/Kolkata'
});