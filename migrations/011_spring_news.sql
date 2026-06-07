-- Spring 2026 changelog post (idempotent)
INSERT INTO news (title, body)
SELECT 'Spring 2026 Update', $body$
Live streaming on your dashboard — see what is playing across all servers in real time, with buffering detection.

Audio ranking — rank, hide, or send-to-bottom audio formats; quick presets for Shield, Apple TV, and Sonos setups.

Library rows — Recently Added, Continue Watching, Next Up, and Favorites as separate Stremio home rows.

Try the new Solstice theme in Settings.
$body$
WHERE NOT EXISTS (
  SELECT 1 FROM news WHERE title = 'Spring 2026 Update'
);