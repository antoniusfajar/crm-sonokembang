// Jalankan di VPS: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: 'crm-vps',
    script: 'src/index.js',
    instances: 1, // WAJIB 1: cron tidak boleh jalan ganda
    autorestart: true,
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
  }],
};
