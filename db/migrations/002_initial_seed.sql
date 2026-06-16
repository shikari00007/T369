INSERT INTO users (id, display_name)
VALUES (1, 'Local Hero')
ON CONFLICT (id) DO NOTHING;

INSERT INTO settings (user_id, theme, preferences)
VALUES (1, 'dark', '{"animations": true, "glass": true}'::jsonb)
ON CONFLICT (user_id) DO NOTHING;
