#!/usr/bin/env node
import { runApply } from './commands/apply.js';
import { runCheck } from './commands/check.js';
import { runCompile } from './commands/compile.js';
import { runConfidence } from './commands/confidence.js';
import { runContext } from './commands/context.js';
import { runDev } from './commands/dev.js';
import { routeEvolve } from './commands/evolve/index.js';
import { runGaps } from './commands/gaps.js';
import { runImport } from './commands/import.js';
import { runInit } from './commands/init.js';
import { runMigrate } from './commands/migrate.js';
import { runRag } from './commands/rag.js';
import { runReview } from './commands/review.js';
import { runRun } from './commands/run.js';
import { runInitTemplates, runScan } from './commands/scan.js';
import { runSchema } from './commands/schema.js';
import { runSelfCoverage } from './commands/self-coverage.js';
import { runSidecarInstall } from './commands/sidecar-install.js';
import { runTest } from './commands/test.js';
import { printHelp, runTranspile } from './commands/transpile.js';

const args = process.argv.slice(2);
const cmd = args[0];

// ── Command registry ─────────────────────────────────────────────────────

const COMMANDS: Record<string, (args: string[]) => void | Promise<void>> = {
  dev: runDev,
  check: runCheck,
  compile: runCompile,
  init: runInit,
  test: runTest,
  scan: runScan,
  gaps: runGaps,
  'init-templates': runInitTemplates,
  import: runImport,
  migrate: runMigrate,
  rag: runRag,
  run: runRun,
  review: runReview,
  context: runContext,
  apply: runApply,
  confidence: runConfidence,
  schema: runSchema,
  'self-coverage': runSelfCoverage,
  'sidecar-install': runSidecarInstall,
};

async function main(): Promise<void> {
  try {
    if (cmd === '--help' || cmd === '-h') {
      printHelp();
      return;
    }

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

    const flagsWithValue = new Set(['--target', '--structure', '--emit', '--python-model-backend', '--outdir']);
    let hasInputFile = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const eqIdx = arg.indexOf('=');
        if (eqIdx === -1 && flagsWithValue.has(arg)) {
          i++;
        }
      } else {
        hasInputFile = true;
        break;
      }
    }

    if (!hasInputFile) {
      printHelp();
      process.exit(1);
    }

    // Treat as file input for transpile
    runTranspile(args);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

await main();
