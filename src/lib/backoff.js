// Exponential backoff with "full jitter".
//   delay = random(0, min(cap, base * 2^attempt))
// The jitter spreads retries out in time so a fleet of failed deliveries to a
// recovering endpoint doesn't stampede it all at the same instant
// (the "thundering herd" problem).

const BASE_MS = 5_000; // 5 seconds
const CAP_MS = 60 * 60_000; // 1 hour ceiling

export function nextAttemptDelayMs(attemptCount) {
  const exp = Math.min(CAP_MS, BASE_MS * 2 ** attemptCount);
  return Math.floor(Math.random() * exp);
}

export function nextAttemptAt(attemptCount, from = Date.now()) {
  return new Date(from + nextAttemptDelayMs(attemptCount));
}
