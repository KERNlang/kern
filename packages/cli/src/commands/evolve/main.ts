import { existsSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import { evolve, loadBuiltinDetectors } from '@kernlang/evolve';
import type { EvolveOptions } from '@kernlang/evolve';
import { parseFlag, hasFlag } from '../../shared.js';

export async function runEvolve(args: string[]): Promise<void> {
  const evolveInput = args[1];
  if (!evolveInput || evolveInput.startsWith('--')) {
    console.error('Usage: kern evolve <dir|file> [--recursive] [--preview] [--min-confidence=N] [--min-support=N] [--json]');
    process.exit(1);
  }

  const evolvePath = resolve(evolveInput);
  const stat = existsSync(evolvePath) ? statSync(evolvePath) : null;
  if (!stat) {
    console.error(`Not found: ${evolveInput}`);
    process.exit(1);
  }

  const recursive = hasFlag(args, '--recursive', '-r');
  const preview = hasFlag(args, '--preview');
  const jsonOutput = hasFlag(args, '--json');
  const minConfArg = parseFlag(args, '--min-confidence');
  const minSupportArg = parseFlag(args, '--min-support');

  const enableNodes = hasFlag(args, '--nodes', '--from-gaps');
  const evolveOptions: EvolveOptions = {
    recursive,
    preview,
    enableNodeProposals: enableNodes,
    thresholds: {
      ...(minConfArg ? { minConfidence: Number(minConfArg) } : {}),
      ...(minSupportArg ? { minSupport: Number(minSupportArg) } : {}),
    },
  };

  await loadBuiltinDetectors();

  console.log(`\n  KERN evolve — scanning for template gaps\n`);
  console.log(`  Input: ${relative(process.cwd(), evolvePath) || '.'}`);
  console.log(`  Mode:  ${preview ? 'preview (no staging)' : 'detect + stage'}`);
  console.log('');

  const result = evolve(evolvePath, evolveOptions);

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`  Gaps detected:       ${result.gaps.length}`);
    if (result.conceptSummary) {
      console.log(`  ${result.conceptSummary.formatted}`);
    }
    console.log(`  Patterns analyzed:   ${result.analyzed.length}`);
    console.log(`  Templates proposed:  ${result.proposals.length}`);
    console.log(`  Validated:           ${result.validated.filter(v => v.validation.parseOk && v.validation.expansionOk).length}/${result.validated.length}`);

    if (!preview && result.staged.length > 0) {
      console.log(`  Staged for review:   ${result.staged.length}`);
      console.log(`\n  Run 'kern evolve:review --list' to review proposals.`);
    }

    if (result.proposals.length > 0) {
      console.log('\n  Proposed templates:');
      for (const p of result.proposals) {
        const v = result.validated.find(v => v.proposal.id === p.id);
        const status = v ? (v.validation.parseOk && v.validation.expansionOk ? '✓' : '✗') : '?';
        console.log(`    ${status} ${p.templateName} (${p.namespace}) — score: ${p.qualityScore.overallScore}, instances: ${p.instanceCount}`);
      }
    }

    if (result.nodeProposals && result.nodeProposals.length > 0) {
      console.log(`\n  Node proposals (v3): ${result.nodeProposals.length}`);
      for (const np of result.nodeProposals) {
        const nv = result.nodeValidated?.find(v => v.proposal.id === np.id);
        const status = nv ? (nv.validation.parseOk && nv.validation.codegenOk ? '✓' : '✗') : '?';
        console.log(`    ${status} ${np.nodeName} — express: ${np.expressibilityScore.overall}, freq: ${np.frequency}, score: ${np.qualityScore}`);
      }
      if (result.stagedNodes && result.stagedNodes.length > 0) {
        console.log(`  Staged nodes:        ${result.stagedNodes.length}`);
      }
    }
  }

  console.log('');
  process.exit(0);
}
