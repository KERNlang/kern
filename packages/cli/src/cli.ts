#!/usr/bin/env node
import { runCompile } from './commands/compile.js';
import { runConfidence } from './commands/confidence.js';
import { runDev } from './commands/dev.js';
import { routeEvolve } from './commands/evolve/index.js';
import { runReview } from './commands/review.js';
import { runInitTemplates, runScan } from './commands/scan.js';
import { printHelp, runTranspile } from './commands/transpile.js';

const args = process.argv.slice(2);
const cmd = args[0];

// ── Command registry ─────────────────────────────────────────────────────

const COMMANDS: Record<string, (args: string[]) => void | Promise<void>> = {
  dev: runDev,
  compile: runCompile,
  scan: runScan,
  'init-templates': runInitTemplates,
  review: runReview,
  confidence: runConfidence,
};

async function main(): Promise<void> {
  // Route evolve commands (evolve + evolve:*)
  if (cmd === 'evolve' || cmd?.startsWith('evolve:')) {
    await routeEvolve(args);
    return;
  }

  // Route standard commands
  const handler = cmd ? COMMANDS[cmd] : undefined;
  if (handler) {
    await handler(args);
    return;
  }

  // No command match — default to transpile mode (kern <file.kern> [options])
  // or show help if no input file given
  if (!cmd || cmd.startsWith('--')) {
    printHelp();
    process.exit(1);
  }

  // Treat as file input for transpile
  runTranspile(args);
}

await main();
