// BUG: cookie set without secure, httpOnly, or sameSite flags
import type { Request, Response } from 'express';

export function setSession(req: Request, res: Response): void {
  const token = req.body.token as string;
  res.cookie('session', token); // no security flags
  res.send('OK');
}
