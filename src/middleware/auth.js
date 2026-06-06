import crypto from 'node:crypto';
import { config } from '../config.js';

// Simple shared-secret auth for management/ingest endpoints.
// Constant-time compare to avoid leaking the key via timing.
export function apiKeyAuth(req, res, next) {
  const provided = req.get('x-api-key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(config.apiKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'invalid or missing API key' });
  }
  next();
}
