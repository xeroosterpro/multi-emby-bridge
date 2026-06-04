-- Persist the rich best-file + per-server breakdown that the Request-log page
-- renders. Migration 006 only kept scalar columns, so the UI's "Best File" and
-- "Server Results" columns had no data to show.
ALTER TABLE request_log ADD COLUMN IF NOT EXISTS best_file     JSONB;
ALTER TABLE request_log ADD COLUMN IF NOT EXISTS server_status JSONB;
