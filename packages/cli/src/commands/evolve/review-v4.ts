import {
  listStagedEvolveV4, getStagedEvolveV4, updateStagedEvolveV4Status,
  cleanRejectedEvolveV4, cleanApprovedEvolveV4, formatEvolveV4SplitView,
  compileCodegenToJS, graduateNode,
} from '@kernlang/evolve';
import { parseFlagOrNext, hasFlag } from '../../shared.js';

export async function runEvolveReviewV4(args: string[]): Promise<void> {
  const approveV4Id = parseFlagOrNext(args, '--approve');
  const rejectV4Id = parseFlagOrNext(args, '--reject');
  const detailV4Id = parseFlagOrNext(args, '--detail');

  if (approveV4Id) {
    const staged = getStagedEvolveV4(approveV4Id);
    if (!staged) {
      console.error(`  Not found: ${approveV4Id}`);
      process.exit(1);
    }

    const { proposal, validation } = staged;
    const allOk = validation.schemaOk && validation.keywordOk && validation.parseOk && validation.codegenCompileOk && validation.codegenRunOk;
    if (!allOk) {
      console.error(`  Cannot approve — validation failed for '${proposal.keyword}':`);
      for (const err of validation.errors) {
        console.error(`    ${err}`);
      }
      process.exit(1);
    }

    let compiledJs: string;
    try {
      compiledJs = compileCodegenToJS(proposal.codegenSource);
    } catch (err) {
      console.error(`  Failed to compile codegen for '${proposal.keyword}': ${(err as Error).message}`);
      process.exit(1);
    }

    const result = graduateNode(proposal, compiledJs);
    if (result.success) {
      updateStagedEvolveV4Status(approveV4Id, 'approved');
      cleanApprovedEvolveV4(approveV4Id);
      console.log(`  Graduated '${proposal.keyword}' → ${result.path}`);
      console.log(`  The node is now available in kern compile and kern dev.`);
    } else {
      console.error(`  Graduation failed: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (rejectV4Id) {
    const updated = updateStagedEvolveV4Status(rejectV4Id, 'rejected');
    if (updated) {
      console.log(`  Rejected: ${updated.proposal.keyword} (${rejectV4Id})`);
      cleanRejectedEvolveV4();
    } else {
      console.error(`  Not found: ${rejectV4Id}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (detailV4Id) {
    const staged = getStagedEvolveV4(detailV4Id);
    if (!staged) {
      console.error(`  Not found: ${detailV4Id}`);
      process.exit(1);
    }
    const { proposal, validation } = staged;
    console.log(`\n  DETAIL: ${proposal.keyword} (${proposal.displayName})\n`);
    console.log(`  Description: ${proposal.description}`);
    console.log(`  Props: ${proposal.props.map(p => `${p.name}:${p.type}${p.required ? '*' : ''}`).join(', ')}`);
    console.log(`  Child types: ${proposal.childTypes.join(', ') || '(none)'}`);
    console.log(`  Codegen tier: ${proposal.codegenTier}`);
    console.log(`  Run ID: ${proposal.evolveRunId}`);
    if (proposal.parserHints) {
      console.log(`  Parser hints: ${JSON.stringify(proposal.parserHints)}`);
    }
    console.log(`\n  --- Codegen Source ---`);
    console.log(proposal.codegenSource);
    console.log(`  --- Instances (${proposal.reason.instances.length}) ---`);
    for (const inst of proposal.reason.instances.slice(0, 10)) {
      console.log(`    ${inst}`);
    }
    if (validation.errors.length > 0) {
      console.log(`\n  --- Validation Errors ---`);
      for (const err of validation.errors) {
        console.log(`    ${err}`);
      }
    }
    console.log('');
    process.exit(0);
  }

  // Default: interactive review or list mode
  const stagedV4 = listStagedEvolveV4();
  const pendingV4 = stagedV4.filter(s => s.status === 'pending');
  if (pendingV4.length === 0) {
    console.log('  No pending v4 proposals. Run \'kern evolve:discover <dir>\' to find patterns.');
    process.exit(0);
  }

  const listOnly = hasFlag(args, '--list');

  if (listOnly) {
    console.log(`\n  KERN evolve:review-v4 — ${pendingV4.length} proposal(s)\n`);
    for (const s of pendingV4) {
      console.log(formatEvolveV4SplitView(s));
      console.log('');
    }
    process.exit(0);
  }

  // Interactive review
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));

  console.log(`\n  KERN evolve:review-v4 — ${pendingV4.length} proposal(s)\n`);

  for (const staged of pendingV4) {
    console.log(formatEvolveV4SplitView(staged));
    console.log('');

    let decided = false;
    while (!decided) {
      const answer = (await ask('  [a]pprove  [r]eject  [s]kip  [d]etail  [q]uit > ')).trim().toLowerCase();

      if (answer === 'a' || answer === 'approve') {
        const { proposal, validation } = staged;
        const allOk = validation.schemaOk && validation.keywordOk && validation.parseOk && validation.codegenCompileOk && validation.codegenRunOk;
        if (!allOk) {
          console.log(`  Cannot approve — validation failed. Use [d]etail to see errors.\n`);
          continue;
        }
        try {
          const compiledJs = compileCodegenToJS(proposal.codegenSource);
          const result = graduateNode(proposal, compiledJs);
          if (result.success) {
            updateStagedEvolveV4Status(staged.id, 'approved');
            cleanApprovedEvolveV4(staged.id);
            console.log(`  \u2713 Graduated '${proposal.keyword}'\n`);
          } else {
            console.log(`  Graduation failed: ${result.error}\n`);
          }
        } catch (err) {
          console.log(`  Error: ${(err as Error).message}\n`);
        }
        decided = true;
      } else if (answer === 'r' || answer === 'reject') {
        updateStagedEvolveV4Status(staged.id, 'rejected');
        cleanRejectedEvolveV4();
        console.log(`  \u2717 Rejected '${staged.proposal.keyword}'\n`);
        decided = true;
      } else if (answer === 's' || answer === 'skip') {
        console.log(`  Skipped.\n`);
        decided = true;
      } else if (answer === 'd' || answer === 'detail') {
        const { proposal, validation } = staged;
        console.log(`\n  --- Codegen Source ---`);
        console.log(proposal.codegenSource);
        console.log(`  --- Instances (${proposal.reason.instances.length}) ---`);
        for (const inst of proposal.reason.instances.slice(0, 5)) {
          console.log(`    ${inst}`);
        }
        if (validation.errors.length > 0) {
          console.log(`  --- Errors ---`);
          for (const err of validation.errors) {
            console.log(`    ${err}`);
          }
        }
        console.log('');
      } else if (answer === 'q' || answer === 'quit') {
        rl.close();
        process.exit(0);
      }
    }
  }

  rl.close();
  console.log('  Review complete.\n');
  process.exit(0);
}
