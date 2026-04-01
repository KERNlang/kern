// BUG: eval() called with user input — arbitrary code execution
import type { Request, Response } from 'express';

export function calculate(req: Request, res: Response): void {
  const expression = req.query.expr as string;
  const result = eval(expression); // user-controlled eval
  res.json({ result });
}
