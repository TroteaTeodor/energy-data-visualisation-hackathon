import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

// GET /api/households
router.get('/', async (_, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, created_at FROM households ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/households/:id/consumption
// Body: { days: [{ date, day_of_week, watts_series: int[], appliance_states: { id: int[] } }] }
router.post('/:id/consumption', async (req, res) => {
  const householdId = parseInt(req.params.id, 10);
  const { days } = req.body;

  if (!Array.isArray(days) || days.length === 0) {
    return res.status(400).json({ error: 'days must be a non-empty array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Overwrite existing data for this household
    await client.query(
      'DELETE FROM consumption_days WHERE household_id = $1',
      [householdId]
    );

    for (const day of days) {
      await client.query(
        `INSERT INTO consumption_days (household_id, date, day_of_week, watts_series, price_series)
         VALUES ($1, $2, $3, $4, $5)`,
        [householdId, day.date, day.day_of_week, day.watts_series, day.price_series ?? null]
      );
    }

    await client.query('COMMIT');
    res.json({ saved: days.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// GET /api/households/:id/consumption — list saved dates
router.get('/:id/consumption', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT date::text, day_of_week FROM consumption_days WHERE household_id = $1 ORDER BY date',
      [parseInt(req.params.id, 10)]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/households/:id/consumption/:date — one day's full series
router.get('/:id/consumption/:date', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT date::text, day_of_week, watts_series, price_series
       FROM consumption_days WHERE household_id = $1 AND date = $2`,
      [parseInt(req.params.id, 10), req.params.date]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
