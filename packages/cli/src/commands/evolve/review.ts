import { cleanRejected, formatSplitView, listStaged, promoteLocal, updateStagedStatus } from '@kernlang/evolve';
import { hasFlag, parseFlagOrNext } from '../../shared.js';

export function runEvolveReview(args: string[]): void {
  const _listMode = hasFlag(args, '--list') || args.length === 1;
  const approveId = parseFlagOrNext(args, '--approve');
  const rejectId = parseFlagOrNext(args, '--reject');
  const promoteMode = hasFlag(args, '--promote');
  const isLocal = hasFlag(args, '--local') || !hasFlag(args, '--catalog');

  if (approveId) {
    const updated = updateStagedStatus(approveId, 'approved');
    if (updated) {
      console.log(`  Approved: ${approveId}`);
    } else {
      console.error(`  Not found: ${approveId}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (rejectId) {
    const updated = updateStagedStatus(rejectId, 'rejected');
    if (updated) {
      console.log(`  Rejected: ${rejectId}`);
      cleanRejected();
    } else {
      console.error(`  Not found: ${rejectId}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (promoteMode) {
    if (!isLocal) {
      console.log('  Catalog promotion is for contributors who want to upstream templates.');
      console.log('  Use --local (default) to write templates to your project.');
      process.exit(0);
    }

    const promoted = promoteLocal();
    if (promoted.length === 0) {
      console.log('  No approved proposals to promote.');
    } else {
      console.log(`  Promoted ${promoted.length} template(s) to templates/:`);
      for (const name of promoted) {
        console.log(`    ${name}`);
      }
    }
    process.exit(0);
  }

  // Default: list mode
  const staged = listStaged();
  if (staged.length === 0) {
    console.log("  No staged proposals. Run 'kern evolve <dir>' to detect gaps.");
    process.exit(0);
  }

  console.log(`\n  KERN evolve:review — ${staged.length} proposal(s)\n`);
  for (const s of staged) {
    console.log(formatSplitView(s));
    console.log('');
  }
  process.exit(0);
}
