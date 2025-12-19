module.exports = {
  apps: [{
    name: 'dev-browser',
    script: 'scripts/start-server.ts',
    interpreter: 'bun',
    cwd: __dirname,
    env: {
      HOST: '0.0.0.0',
      LAZY: 'true',
    },
    // Restart on crash
    autorestart: true,
    // Wait 1 second before restarting
    restart_delay: 1000,
    // Max restarts in 15 minutes before stopping
    max_restarts: 10,
    // Merge stdout and stderr
    merge_logs: true,
    // Log file locations
    out_file: 'logs/dev-browser.log',
    error_file: 'logs/dev-browser-error.log',
    // Watch for changes (disabled by default - enable for development)
    watch: false,
  }]
};
