import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

const log = logger.child({ component: 'api' });
const app = createApp();

const server = app.listen(config.port, () => {
  log.info({ port: config.port }, 'ingest API listening');
});

function shutdown(signal) {
  log.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
