-- Enhanced support tickets: priority, category, extended status workflow
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('open', 'in_progress', 'closed', 'resolved'));

DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_priority_check
    CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_category_check
    CHECK (category IN ('general', 'streaming', 'servers', 'billing', 'bug', 'feature'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_category ON tickets(category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority, updated_at DESC);