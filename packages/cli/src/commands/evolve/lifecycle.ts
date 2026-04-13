import { NODE_TYPES } from '@kernlang/core';
import {
  detectCollisions,
  formatGoldenTestResults,
  promoteNode,
  pruneNodes,
  readEvolvedManifest,
  rebuildEvolvedManifest,
  renameEvolvedNode,
  restoreNode,
  rollbackNode,
  runGoldenTests,
} from '@kernlang/evolve';
import { relative } from 'path';
import { hasFlag, parseFlag } from '../../shared.js';

export function runEvolveTest(): void {
  console.log('\n  KERN evolve:test — golden test runner\n');
  const results = runGoldenTests();
  console.log(formatGoldenTestResults(results));
  const failed = results.filter((r) => !r.pass).length;
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

export function runEvolveRollback(args: string[]): void {
  const keyword = args[1];
  if (!keyword || keyword.startsWith('--')) {
    console.error('Usage: kern evolve:rollback <keyword> [--force]');
    process.exit(1);
  }

  const force = hasFlag(args, '--force');
  const result = rollbackNode(keyword, process.cwd(), force);

  if (result.success) {
    console.log(`  Rolled back '${keyword}' (moved to .trash/).`);
    console.log(`  Restore with: kern evolve:restore ${keyword}`);
  } else {
    console.error(`  Failed: ${result.error}`);
    if (result.usageFiles) {
      console.error('  Used in:');
      for (const f of result.usageFiles.slice(0, 5)) {
        console.error(`    ${relative(process.cwd(), f)}`);
      }
    }
    process.exit(1);
  }
  process.exit(0);
}

export function runEvolveRestore(args: string[]): void {
  const keyword = args[1];
  if (!keyword) {
    console.error('Usage: kern evolve:restore <keyword>');
    process.exit(1);
  }

  const result = restoreNode(keyword);
  if (result.success) {
    console.log(`  Restored '${keyword}'.`);
  } else {
    console.error(`  Failed: ${result.error}`);
    process.exit(1);
  }
  process.exit(0);
}

export function runEvolveList(): void {
  const manifest = readEvolvedManifest();

  if (!manifest || Object.keys(manifest.nodes).length === 0) {
    console.log("\n  No evolved nodes graduated. Run 'kern evolve:discover' to start.\n");
    process.exit(0);
  }

  console.log(`\n  KERN evolved nodes — ${Object.keys(manifest.nodes).length} graduated\n`);
  for (const [keyword, entry] of Object.entries(manifest.nodes)) {
    console.log(
      `  ${keyword} — ${entry.displayName} (graduated ${entry.graduatedAt.split('T')[0]} by ${entry.graduatedBy})`,
    );
  }
  console.log('');
  process.exit(0);
}

export function runEvolvePromote(args: string[]): void {
  const promoteKeyword = args[1];
  if (!promoteKeyword || promoteKeyword.startsWith('--')) {
    console.error('Usage: kern evolve:promote <keyword>');
    console.error('  Reads codegen from .kern/evolved/<keyword>/ and outputs what to add to core.');
    process.exit(1);
  }

  const result = promoteNode(promoteKeyword);
  if (!result.success) {
    console.error(`  Failed: ${result.error}`);
    process.exit(1);
  }

  const fnName =
    'generate' +
    promoteKeyword
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('');
  console.log(`\n  KERN evolve:promote — ${promoteKeyword}\n`);
  console.log('  To promote this node to core, apply these changes:\n');
  console.log(`  1. Add '${promoteKeyword}' to NODE_TYPES in packages/core/src/spec.ts`);
  console.log(`  2. Create packages/core/src/generators/${fnName}.ts with:`);
  console.log(`     ──────────────────────────────`);
  for (const line of (result.codegenTs || '').split('\n').slice(0, 20)) {
    console.log(`     ${line}`);
  }
  if ((result.codegenTs || '').split('\n').length > 20) {
    console.log(`     ... (${(result.codegenTs || '').split('\n').length - 20} more lines)`);
  }
  console.log(`     ──────────────────────────────`);
  console.log(`  3. Add case '${promoteKeyword}': return ${fnName}(node); to generateCoreNode() in codegen-core.ts`);
  if (result.goldenKern) {
    console.log(`  4. Move golden test to packages/core/tests/`);
  }
  console.log(`  5. Run: kern evolve:rollback ${promoteKeyword} --force`);
  console.log('');
  process.exit(0);
}

export function runEvolvePrune(args: string[]): void {
  const dryRun = hasFlag(args, '--dry-run');
  const daysArg = parseFlag(args, '--days');
  const thresholdDays = daysArg ? Number(daysArg) : 90;

  console.log(`\n  KERN evolve:prune — removing unused nodes (>${thresholdDays}d)\n`);

  const results = pruneNodes(process.cwd(), thresholdDays, dryRun);

  if (results.length === 0) {
    console.log('  No nodes eligible for pruning.');
    process.exit(0);
  }

  for (const r of results) {
    if (dryRun) {
      console.log(`  Would prune: ${r.keyword} (${r.daysUnused}d unused)`);
    } else if (r.pruned) {
      console.log(`  Pruned: ${r.keyword} (${r.daysUnused}d unused) → .trash/`);
    } else {
      console.log(`  Failed: ${r.keyword} — ${r.error}`);
    }
  }

  if (dryRun) {
    console.log(`\n  Dry run — no changes made. Remove --dry-run to prune.`);
  }

  console.log('');
  process.exit(0);
}

export function runEvolveMigrate(args: string[]): void {
  console.log(`\n  KERN evolve:migrate — checking for keyword collisions\n`);

  const collisions = detectCollisions(NODE_TYPES);

  if (collisions.length === 0) {
    console.log('  No collisions. All evolved nodes are compatible with core.');
    process.exit(0);
  }

  console.log(`  Found ${collisions.length} collision(s):\n`);
  for (const c of collisions) {
    console.log(`  ${c.keyword} (graduated ${c.graduatedAt.split('T')[0]})`);
    console.log(`    This keyword now exists in core NODE_TYPES.`);
    console.log(`    Options:`);
    console.log(`      kern evolve:migrate --rename=${c.keyword} --to=<new-name>`);
    console.log(`      kern evolve:migrate --remove=${c.keyword}  (core version supersedes)`);
    console.log('');
  }

  const renameArg = parseFlag(args, '--rename');
  const toArg = parseFlag(args, '--to');
  const removeArg = parseFlag(args, '--remove');

  if (renameArg && toArg) {
    const result = renameEvolvedNode(renameArg, toArg);
    if (result.success) {
      console.log(`  Renamed '${renameArg}' → '${toArg}'`);
      console.log(`  Update your .kern files: replace '${renameArg}' with '${toArg}'.`);
    } else {
      console.error(`  Rename failed: ${result.error}`);
      process.exit(1);
    }
  }

  if (removeArg) {
    const result = rollbackNode(removeArg, process.cwd(), true);
    if (result.success) {
      console.log(`  Removed evolved '${removeArg}' — core version will be used.`);
    } else {
      console.error(`  Remove failed: ${result.error}`);
      process.exit(1);
    }
  }

  console.log('');
  process.exit(0);
}

export function runEvolveRebuild(): void {
  console.log(`\n  KERN evolve:rebuild — rebuilding manifest from disk\n`);

  const result = rebuildEvolvedManifest();

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`  ⚠  ${err}`);
    }
    console.log('');
  }

  if (result.rebuilt === 0 && result.errors.length > 0) {
    console.error('  No nodes rebuilt.');
    process.exit(1);
  }

  console.log(`  manifest.json rebuilt with ${result.rebuilt} node(s).`);
  console.log('');
  process.exit(0);
}
