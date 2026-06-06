import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Ingest API listening on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
