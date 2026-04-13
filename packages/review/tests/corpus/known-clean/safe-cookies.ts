// CLEAN: cookie set with secure, httpOnly, and sameSite flags
import type { Request, Response } from 'express';

export function setSession(req: Request, res: Response): void {
  const token = req.body.token as string;
  res.cookie('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 3600000,
  });
  res.send('OK');
}
