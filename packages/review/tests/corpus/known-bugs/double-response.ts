// BUG: res.send() called twice without return — headers already sent error
import type { Request, Response } from 'express';

export function handler(req: Request, res: Response): void {
  if (req.query.error) {
    res.status(400).send('Bad request'); // no return after send
  }
  res.send('OK'); // second send — crashes if error branch ran
}
