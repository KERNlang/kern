import { type Express, type NextFunction, type Request, type Response } from 'express';

type RouteParams = Record<string, never>;
type RequestQuery = Record<string, never>;
type RequestBody = Record<string, never>;
type ResponseBody = unknown;

export function registerGetHealthRoute(app: Express): void {
  app.get('/health', async (req: Request<RouteParams, ResponseBody, RequestBody, RequestQuery>, res: Response, next: NextFunction) => {
    try {
      res.json({ ok: true, uptime: process.uptime() });
    } catch (error) {
      next(error);
    }
  });
}