import { runCompile } from './compile.js';

/**
 * `kern dev` — alias for `kern compile --watch`.
 *
 * Injects `--watch` and remaps the command name so that compile receives
 * the same argument shape it expects (`args[1]` = input path).
 */
export async function runDev(args: string[]): Promise<void> {
  console.log('  Note: kern dev is now an alias for kern compile --watch\n');

  // Build compile args: replace 'dev' with 'compile' and inject --watch
  const compileArgs = ['compile', ...args.slice(1)];
  if (!compileArgs.includes('--watch')) {
    compileArgs.push('--watch');
  }

  await runCompile(compileArgs);
}
