// CLEAN: validated input, single response with return, error middleware
import type { Request, Response, NextFunction } from 'express';

interface CreateUserBody {
  name: string;
  email: string;
}

function isValidBody(body: unknown): body is CreateUserBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as CreateUserBody).name === 'string' &&
    typeof (body as CreateUserBody).email === 'string'
  );
}

export function createUser(req: Request, res: Response, next: NextFunction): void {
  if (!isValidBody(req.body)) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const user = { name: req.body.name, email: req.body.email };
  res.status(201).json(user);
}
