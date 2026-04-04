import { NODE_TYPES } from '@kernlang/core';
import type { LLMProviderOptions } from '@kernlang/evolve';
import {
  buildDiscoveryPrompt,
  buildRetryPrompt,
  collectTsFiles,
  createLLMProvider,
  estimateTokens,
  parseDiscoveryResponse,
  readEvolvedManifest,
  selectRepresentativeFiles,
  stageEvolveV4Proposal,
  TokenBudget,
  validateEvolveProposal,
} from '@kernlang/evolve';
import { existsSync, readFileSync } from 'fs';
import { relative, resolve } from 'path';
import { hasFlag, parseFlag } from '../../shared.js';

export async function runEvolveDiscover(args: string[]): Promise<void> {
  const discoverInput = args[1];
  if (!discoverInput || discoverInput.startsWith('--')) {
    console.error(
      'Usage: kern evolve:discover <dir> [--recursive] [--provider=openai|anthropic|ollama] [--max-tokens=N]',
    );
    process.exit(1);
  }

  const discoverPath = resolve(discoverInput);
  if (!existsSync(discoverPath)) {
    console.error(`Not found: ${discoverInput}`);
    process.exit(1);
  }

  const recursive = hasFlag(args, '--recursive', '-r');
  const providerArg = parseFlag(args, '--provider') as LLMProviderOptions['provider'];
  const maxTokensArg = parseFlag(args, '--max-tokens');
  const maxTokens = maxTokensArg ? Number(maxTokensArg) : 100000;

  console.log(`\n  KERN evolve:discover — LLM pattern discovery\n`);
  console.log(`  Input: ${relative(process.cwd(), discoverPath) || '.'}`);

  const tsFiles = collectTsFiles(discoverPath, recursive);
  console.log(`  Files found: ${tsFiles.length}`);

  if (tsFiles.length === 0) {
    console.log('  No TypeScript files to analyze.');
    process.exit(0);
  }

  const batches = selectRepresentativeFiles(tsFiles);
  console.log(`  Batches: ${batches.length} (sampling representative files)`);

  const manifest = readEvolvedManifest();
  const evolvedKeywords = manifest ? Object.keys(manifest.nodes) : [];

  let provider;
  try {
    provider = createLLMProvider({ provider: providerArg });
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`  Provider: ${provider.name}`);

  const budget = new TokenBudget(maxTokens);
  const allProposals: import('@kernlang/evolve').EvolveNodeProposal[] = [];
  const runId = `run-${Date.now()}`;

  for (let i = 0; i < batches.length; i++) {
    if (budget.exhausted) {
      console.log(`  Token budget exhausted (${budget}). Stopping.`);
      break;
    }

    const batch = batches[i];
    const files = batch.map((fp) => ({
      path: relative(process.cwd(), fp),
      content: readFileSync(fp, 'utf-8'),
    }));

    const prompt = buildDiscoveryPrompt(files, NODE_TYPES, evolvedKeywords);
    budget.add(estimateTokens(prompt));

    console.log(`  Batch ${i + 1}/${batches.length}: ${files.map((f) => f.path).join(', ')}`);

    try {
      const response = await provider.complete(prompt);
      budget.add(estimateTokens(response));

      const proposals = parseDiscoveryResponse(response, runId);
      allProposals.push(...proposals);

      if (proposals.length > 0) {
        console.log(`    → ${proposals.length} pattern(s) found: ${proposals.map((p) => p.keyword).join(', ')}`);
      }
    } catch (err) {
      console.error(`    → Error: ${(err as Error).message}`);
    }
  }

  // Dedup across batches
  const seen = new Set<string>();
  const uniqueProposals = allProposals.filter((p) => {
    if (seen.has(p.keyword)) return false;
    seen.add(p.keyword);
    return true;
  });

  console.log(`\n  Discovery complete.`);
  console.log(`  Tokens used: ${budget}`);
  console.log(`  Proposals: ${uniqueProposals.length}\n`);

  // Validate and stage proposals
  const existingKw = [...(NODE_TYPES as readonly string[]), ...evolvedKeywords];
  let stagedCount = 0;
  const maxRetries = 2;

  for (let pi = 0; pi < uniqueProposals.length; pi++) {
    const proposal = uniqueProposals[pi];
    if (!proposal.id) {
      proposal.id = `${proposal.keyword}-${Date.now()}`;
    }

    let validation = validateEvolveProposal(proposal, existingKw);
    let allOk =
      validation.schemaOk &&
      validation.keywordOk &&
      validation.parseOk &&
      validation.codegenCompileOk &&
      validation.codegenRunOk;

    const isFixable = validation.schemaOk && validation.keywordOk && !allOk;
    if (!allOk && isFixable && provider) {
      for (let retry = 1; retry <= maxRetries; retry++) {
        console.log(`  \u21BB ${proposal.keyword} — retry ${retry}/${maxRetries} (feeding errors to LLM)`);
        try {
          const retryPrompt = buildRetryPrompt(proposal, validation.errors);
          budget.add(estimateTokens(retryPrompt));
          const retryResponse = await provider.complete(retryPrompt);
          if (!retryResponse || typeof retryResponse !== 'string')
            throw new Error('LLM returned empty or invalid response');
          budget.add(estimateTokens(retryResponse));

          let json = retryResponse.trim();
          const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
          if (fenceMatch) json = fenceMatch[1].trim();
          const objStart = json.indexOf('{');
          const objEnd = json.lastIndexOf('}');
          if (objStart !== -1 && objEnd > objStart) json = json.slice(objStart, objEnd + 1);

          const fixed = JSON.parse(json);
          if (typeof fixed !== 'object' || fixed === null) throw new Error('LLM retry response is not a JSON object');
          if (typeof fixed.kernExample === 'string') proposal.kernExample = fixed.kernExample;
          if (typeof fixed.expectedOutput === 'string') proposal.expectedOutput = fixed.expectedOutput;
          if (typeof fixed.codegenSource === 'string') proposal.codegenSource = fixed.codegenSource;

          validation = validateEvolveProposal(proposal, existingKw);
          allOk =
            validation.schemaOk &&
            validation.keywordOk &&
            validation.parseOk &&
            validation.codegenCompileOk &&
            validation.codegenRunOk;
          if (allOk) break;
        } catch (e) {
          console.error(`    Retry ${retry} failed: ${(e as Error).message}`);
        }
      }
    }

    const status = allOk ? '\u2713' : '\u2717';
    console.log(`  ${status} ${proposal.keyword} — ${proposal.reason.observation}`);
    if (validation.errors.length > 0) {
      for (const err of validation.errors.slice(0, 3)) {
        console.log(`    ${err}`);
      }
    }

    validation.retryCount = allOk ? 0 : maxRetries;
    stageEvolveV4Proposal(proposal, validation);
    stagedCount++;
  }

  if (stagedCount > 0) {
    console.log(`\n  Staged ${stagedCount} proposal(s).`);
    console.log(`  Run 'kern evolve:review-v4' to review and graduate proposals.`);
  }

  console.log('');
  process.exit(0);
}
