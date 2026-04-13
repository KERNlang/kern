// BUG: tainted user input flows to exec() without sanitization
import { exec } from 'child_process';

export function runCommand(req: Request, _res: Response) {
  const cmd = req.body.command;
  exec(cmd); // command injection
}
