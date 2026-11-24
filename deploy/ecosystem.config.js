// PM2 alternative to Docker (Linux server): `pm2 start deploy/ecosystem.config.js`
module.exports = {
  apps: [
    {
      name: 'medix-api',
      cwd: './backend',
      script: 'dist/main.js',
      instances: 1, // the in-process job queue + cron run once; scale out after moving jobs to BullMQ
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      out_file: '../logs/api.out.log',
      error_file: '../logs/api.err.log',
      time: true,
    },
  ],
};
