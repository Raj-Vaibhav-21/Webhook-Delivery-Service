import crypto from 'node:crypto';

// We sign "<timestamp>.<body>" rather than just the body so receivers can
// reject stale/replayed requests by comparing the timestamp to their clock.
export function signPayload(secret, body, timestamp = Date.now()) {
  const signed = `${timestamp}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return { signature, timestamp };
}

// Constant-time comparison so an attacker can't recover the signature
// byte-by-byte via timing differences. This is the logic a receiver runs.
export function verifySignature(secret, body, timestamp, signature) {
  const { signature: expected } = signPayload(secret, body, timestamp);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
