import { type Express, type NextFunction, type Request, type Response } from 'express';

type RouteParams = Record<string, never>;
type RequestQuery = Record<string, never>;
type RequestBody = {id: string};
type ResponseBody = unknown;

function assertRequiredFields(label: string, value: unknown, requiredKeys: string[]): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid ${label}: expected object payload`);
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw new Error(`Invalid ${label}: missing ${key}`);
    }
  }
}

export function registerPostApiProvidersTestRoute(app: Express): void {
  app.post('/api/providers/test', async (req: Request<RouteParams, ResponseBody, RequestBody, RequestQuery>, res: Response, next: NextFunction) => {
    try {
      assertRequiredFields('body', req.body, ['id']);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) } as any);
    }

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    const timeoutMs = 15000;
    const timer = setTimeout(() => {
      ac.abort();
      res.status(408).json({ ok: false, message: 'Test timed out' });
    }, timeoutMs);
    
    try {
      const provider = registry.get(req.body.id);
      const result = await provider.test();
      res.json({ ok: true, message: result });
    } catch (err) {
      if (!ac.signal.aborted) {
        clearTimeout(timer);
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  });
}