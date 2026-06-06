-- 0001_init.sql
-- Core data model for the webhook delivery service.
-- gen_random_uuid() is built into Postgres core since v13, so no extension needed.
-- NOTE: no BEGIN/COMMIT here on purpose — the migration runner wraps each file
-- in its own transaction.

CREATE TABLE subscriptions (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url  text        NOT NULL,
    event_type  text        NOT NULL,
    secret      text        NOT NULL,          -- per-subscription HMAC secret
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fan-out lookup at ingest: "which active subs want this event_type?"
-- Partial index keeps only the rows we actually query (is_active = true).
CREATE INDEX subscriptions_event_type_active_idx
    ON subscriptions (event_type)
    WHERE is_active;

CREATE TABLE events (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key text        NOT NULL UNIQUE,   -- client-supplied; dedupes retries
    event_type      text        NOT NULL,
    payload         jsonb       NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deliveries (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           uuid        NOT NULL REFERENCES events(id)        ON DELETE CASCADE,
    subscription_id    uuid        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    status             text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','delivering','succeeded','dead')),
    attempt_count      int         NOT NULL DEFAULT 0,
    next_attempt_at    timestamptz NOT NULL DEFAULT now(),
    last_response_code int,
    last_error         text,
    locked_at          timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- one delivery row per (event, subscription): makes fan-out idempotent too
    UNIQUE (event_id, subscription_id)
);

-- THE hot path. The worker polls:
--   WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at
-- A partial index on next_attempt_at (only 'pending' rows) keeps this query
-- tiny and fast even when millions of succeeded/dead rows pile up.
CREATE INDEX deliveries_due_idx
    ON deliveries (next_attempt_at)
    WHERE status = 'pending';

-- Delivery-log endpoint: GET /events/:id/deliveries
CREATE INDEX deliveries_event_idx ON deliveries (event_id);
