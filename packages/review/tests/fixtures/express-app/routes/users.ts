import { type Request, type Response, Router } from 'express';
import { db } from '../db';

const router = Router();

// Handler 1: Has auth guard + error handling (NORM)
router.get('/users', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const users = await db.query('SELECT * FROM users LIMIT $1', [req.query.limit]);
    res.json(users);
  } catch (_err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Handler 2: Has auth guard + error handling (NORM)
router.post('/users', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await db.query('INSERT INTO users (email, name) VALUES ($1, $2)', [req.body.email, req.body.name]);
    res.status(201).json(user);
  } catch (_err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Handler 3: Has auth guard + error handling (NORM)
router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await db.query('UPDATE users SET name = $1 WHERE id = $2', [req.body.name, req.params.id]);
    res.json(user);
  } catch (_err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Handler 4: VIOLATION — no auth guard, no error handling
router.delete('/users/:id', async (req: Request, res: Response) => {
  const _result = await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

export default router;
