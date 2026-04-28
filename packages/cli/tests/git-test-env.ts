import { execFileSync } from 'child_process';
import { withoutLocalGitEnv } from '../src/git-env.js';

export function git(args: string[], cwd?: string): void {
  execFileSync('git', args, {
    cwd,
    env: withoutLocalGitEnv(),
    stdio: 'ignore',
  });
}
