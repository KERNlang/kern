// CLEAN: redirect with URL whitelist — prevents open redirect
import type { Request, Response } from 'express';

const ALLOWED_HOSTS = ['example.com', 'app.example.com'];

export function handleLogin(req: Request, res: Response): void {
  const returnTo = req.query.returnTo as string;
  try {
    const url = new URL(returnTo);
    if (ALLOWED_HOSTS.includes(url.hostname)) {
      res.redirect(returnTo);
      return;
    }
  } catch {
    // invalid URL — fall through to default
  }
  res.redirect('/dashboard');
}
