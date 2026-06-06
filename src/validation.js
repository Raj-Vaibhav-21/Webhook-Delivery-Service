import { z } from 'zod';

export const createSubscriptionSchema = z.object({
  target_url: z.string().url(),
  event_type: z.string().min(1).max(255),
  secret: z.string().min(16).optional(), // auto-generated if omitted
});

export const ingestEventSchema = z.object({
  event_type: z.string().min(1).max(255),
  payload: z.record(z.any()), // any JSON object
});
