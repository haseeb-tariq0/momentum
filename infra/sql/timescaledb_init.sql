-- Run this against your TimescaleDB instance after docker compose up
-- psql $TIMESCALE_URL -f infra/sql/timescaledb_init.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Mirror of time_entries for analytics
CREATE TABLE IF NOT EXISTS time_entries_ts (
  user_id    UUID        NOT NULL,
  task_id    UUID        NOT NULL,
  project_id UUID        NOT NULL,
  date       DATE        NOT NULL,
  hours      NUMERIC(4,2) NOT NULL,
  synced_at  TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT time_entries_ts_pkey PRIMARY KEY (user_id, task_id, date)
);

-- Convert to hypertable partitioned by date
SELECT create_hypertable('time_entries_ts', 'date', if_not_exists => TRUE);

-- Continuous aggregate: weekly hours per user per project
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_hours_by_user
WITH (timescaledb.continuous) AS
SELECT
  user_id,
  project_id,
  time_bucket('7 days', date) AS week,
  SUM(hours) AS total_hours
FROM time_entries_ts
GROUP BY user_id, project_id, week
WITH NO DATA;

-- Refresh policy: update every hour
SELECT add_continuous_aggregate_policy('weekly_hours_by_user',
  start_offset => INTERVAL '1 month',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

-- Index for fast project lookups
CREATE INDEX IF NOT EXISTS idx_ts_project_date ON time_entries_ts (project_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_ts_user_date    ON time_entries_ts (user_id, date DESC);

-- Data retention: keep 2 years of raw data
SELECT add_retention_policy('time_entries_ts', INTERVAL '2 years', if_not_exists => TRUE);
