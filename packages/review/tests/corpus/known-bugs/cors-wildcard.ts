// BUG: CORS configured with wildcard origin — allows any domain
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: '*' }));

app.get('/api/data', (_req, res) => {
  res.json({ secret: 'sensitive-data' });
});

export default app;
