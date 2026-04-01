// BUG: res.redirect with unsanitized user input — open redirect
import type { Request, Response } from 'express';

export function handleLogin(req: Request, res: Response): void {
  const returnUrl = req.query.returnTo as string;
  res.redirect(returnUrl); // attacker can set returnTo=https://evil.com
}
