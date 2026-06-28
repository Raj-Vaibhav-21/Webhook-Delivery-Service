// One structured logger for the whole service. Every line is a JSON object
// (in prod), so CloudWatch / Logs Insights can filter on fields like event_id.
import pino from 'pino';
import { config } from '../config.js';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'webhook-delivery' },
  redact: ['secret', '*.secret'],
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      },
});
