module.exports = {
  apps: [
    {
      name: 'bugradar-server',
      script: 'server/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/server-error.log',
      out_file: 'logs/server-out.log',
      merge_logs: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
    },
  ],
};
