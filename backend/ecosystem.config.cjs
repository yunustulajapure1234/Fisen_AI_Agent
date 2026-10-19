module.exports = {
  apps: [
    {
      name: "fisen-ai-assistant",
      script: "./server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "0.0.0.0",
      },
      watch: false,
      max_memory_restart: "500M",
      autorestart: true,
      exp_backoff_restart_delay: 100,
    },
  ],
};
