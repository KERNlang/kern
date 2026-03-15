import { type Express, type NextFunction, type Request, type Response } from 'express';

type RouteParams = Record<string, never>;
type RequestQuery = Record<string, never>;
type RequestBody = {id: string, enabled: boolean};
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

export function registerPostApiProvidersToggleRoute(app: Express): void {
  app.post('/api/providers/toggle', async (req: Request<RouteParams, ResponseBody, RequestBody, RequestQuery>, res: Response, next: NextFunction) => {
    try {
      assertRequiredFields('body', req.body, ['id', 'enabled']);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) } as any);
    }

    try {
      const provider = registry.get(req.body.id);
            if (!provider) return res.status(404).json({ error: 'Not found' });
            provider.enabled = req.body.enabled;
            registry.register(provider);
            saveConfig();
            res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
}