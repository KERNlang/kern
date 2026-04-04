// BUG: file read with user-controlled path — path traversal

import type { Request, Response } from 'express';
import { readFileSync } from 'fs';

export function serveFile(req: Request, res: Response): void {
  const filename = req.params.name;
  const content = readFileSync(`/uploads/${filename}`, 'utf-8');
  res.send(content); // ../../etc/passwd
}
