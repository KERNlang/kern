import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { registerPostApiReviewRoute } from './routes/post-api-review.js';
import { registerPostApiProvidersToggleRoute } from './routes/post-api-providers-toggle.js';
import { registerPostApiProvidersTestRoute } from './routes/post-api-providers-test.js';
import { registerGetHealthRoute } from './routes/get-health.js';

const app = express();
const port = 19854;
const serverName = 'AIBuddiesAPI';

app.use(cors());
app.use(express.json());

registerPostApiReviewRoute(app);
registerPostApiProvidersToggleRoute(app);
registerPostApiProvidersTestRoute(app);
registerGetHealthRoute(app);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`${serverName} listening on port ${port}`);
});

export default app;