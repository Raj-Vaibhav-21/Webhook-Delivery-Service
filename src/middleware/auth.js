import crypto from 'node:crypto';
import { config } from '../config.js';

export function apiKeyAuth(req, res, next) {
  const provided = req.get('x-api-key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(config.apiKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'invalid or missing API key' });
  }
  next();
}
/* How this line "!crypto.timingSafeEqual(a, b)" prevents timing attack ?
   A normal !== comparison stops at the first mismatched byte. 
   If someone sends key: 'a' and it rejects in 0.1 milliseconds, but then he sends key: 'x' and it rejects in 0.15 milliseconds, 
   he has learned something. Maybe the first byte is closer to 'x' than 'a'. By making millions of requests 
   and measuring nanosecond differences, that person can forge my key byte by byte without ever guessing it outright.
   This is Node's defense: it compares every single byte, regardless of when the mismatch is found. 
   It always takes the same time whether the first byte is wrong or the last byte is wrong. The attacker measuring nanoseconds 
   learns nothing. It's a constant-time comparison function.
*/