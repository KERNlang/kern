// BUG: req.body used directly without any validation or type checking
import type { Request, Response } from 'express';

export function createUser(req: Request, res: Response): void {
  const { name, email, role } = req.body; // no validation
  const user = { name, email, role, createdAt: new Date() };
  res.status(201).json(user);
}
