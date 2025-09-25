const { startServer } = require('./app');

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});