// BUG: exec() with string concatenation of user input — command injection
import { exec } from 'child_process';

export function convert(userFilename: string): void {
  exec('convert ' + userFilename + ' output.png', (err) => {
    if (err) console.error(err);
  });
}
