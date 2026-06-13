CREATE TABLE IF NOT EXISTS households (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'My Home',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consumption_days (
  id           SERIAL PRIMARY KEY,
  household_id INT REFERENCES households(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  day_of_week  TEXT NOT NULL,
  watts_series INT[] NOT NULL,       -- 1440 values, one per minute
  UNIQUE(household_id, date)
);

CREATE INDEX IF NOT EXISTS idx_consumption_days_lookup
  ON consumption_days(household_id, date);

INSERT INTO households (id, name) VALUES (1, 'My Home')
  ON CONFLICT DO NOTHING;
