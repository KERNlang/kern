import { runEvolveBackfill } from './backfill.js';
import { runEvolveDiscover } from './discover.js';
import {
  runEvolveList,
  runEvolveMigrate,
  runEvolvePromote,
  runEvolvePrune,
  runEvolveRebuild,
  runEvolveRestore,
  runEvolveRollback,
  runEvolveTest,
} from './lifecycle.js';
import { runEvolve } from './main.js';
import { runEvolveReview } from './review.js';
import { runEvolveReviewV4 } from './review-v4.js';

const EVOLVE_COMMANDS: Record<string, (args: string[]) => void | Promise<void>> = {
  'evolve:review': runEvolveReview,
  'evolve:discover': runEvolveDiscover,
  'evolve:review-v4': runEvolveReviewV4,
  'evolve:test': runEvolveTest,
  'evolve:rollback': runEvolveRollback,
  'evolve:restore': runEvolveRestore,
  'evolve:list': runEvolveList,
  'evolve:promote': runEvolvePromote,
  'evolve:backfill': runEvolveBackfill,
  'evolve:prune': runEvolvePrune,
  'evolve:migrate': runEvolveMigrate,
  'evolve:rebuild': runEvolveRebuild,
};

export async function routeEvolve(args: string[]): Promise<void> {
  const cmd = args[0];

  // kern evolve:* subcommands
  const handler = EVOLVE_COMMANDS[cmd];
  if (handler) {
    await handler(args);
    return;
  }

  // kern evolve <dir> (main evolve command)
  if (cmd === 'evolve' && args[1] !== undefined && !args[1].startsWith('evolve:')) {
    await runEvolve(args);
    return;
  }

  console.error(`Unknown evolve command: ${cmd}`);
  console.error('Available: evolve, evolve:review, evolve:discover, evolve:review-v4, evolve:test,');
  console.error('  evolve:rollback, evolve:restore, evolve:list, evolve:promote, evolve:backfill,');
  console.error('  evolve:prune, evolve:migrate, evolve:rebuild');
  process.exit(1);
}
