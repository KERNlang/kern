import { type Express, type NextFunction, type Request, type Response } from 'express';

type RouteParams = Record<string, never>;
type RequestQuery = Record<string, never>;
type RequestBody = {diff: string, userNotes?: string};
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

export function registerPostApiReviewRoute(app: Express): void {
  app.post('/api/review', async (req: Request<RouteParams, ResponseBody, RequestBody, RequestQuery>, res: Response, next: NextFunction) => {
    try {
      assertRequiredFields('body', req.body, ['diff']);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) } as any);
    }

    const ac = new AbortController();
    req.on('close', () => ac.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();
    
    const emit = (data: unknown, event?: string) => {
      if (res.writableEnded) return;
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // SSE heartbeat — keeps proxies/browsers from killing the connection
    const heartbeat = setInterval(() => {
      if (res.writableEnded) { clearInterval(heartbeat); return; }
      res.write(': keep-alive\n\n');
    }, 15000);

    await (async () => {
      try {
        const registry = req.app.get('registry');
        const expanded = registry.expandInstances();
        const abortController = new AbortController();
        res.on('close', () => abortController.abort());
        await Promise.allSettled(expanded.map(async (config) => {
        if (abortController.signal.aborted) return;
        const adapter = registry.getAdapter(config.id);
        for await (const event of adapter.stream({
        systemPrompt: getReviewPersona(config.id).systemPrompt,
        userPrompt: req.body.diff,
        })) {
        if (abortController.signal.aborted) break;
        emit(event);
        }
        }));
      } catch (err) {
        emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(heartbeat);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify('[DONE]')}\n\n`);
          res.end();
        }
      }
    })();
  });
}