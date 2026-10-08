import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variabel ${name} belum diisi di .env`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '127.0.0.1',
  apiKey: required('VPS_API_KEY'),
  websiteUrl: (process.env.WEBSITE_URL || '').replace(/\/$/, ''),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASS || '',
    database: required('DB_NAME'),
  },
  wa: {
    mode: process.env.WA_MODE === 'meta' ? 'meta' : 'simulator',
    phoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
    accessToken: process.env.WA_ACCESS_TOKEN || '',
    verifyToken: process.env.WA_VERIFY_TOKEN || '',
    appSecret: process.env.WA_APP_SECRET || '',
  },
};
