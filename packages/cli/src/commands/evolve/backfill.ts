import {
  buildBackfillPrompt,
  createLLMProvider,
  parseLLMJsonObject,
  readNodeDefinition,
  validateBackfillResponse,
} from '@kernlang/evolve';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseFlag } from '../../shared.js';

export async function runEvolveBackfill(args: string[]): Promise<void> {
  const backfillKeyword = args[1];
  if (!backfillKeyword || backfillKeyword.startsWith('--')) {
    console.error('Usage: kern evolve:backfill <keyword> --target=<target> [--provider=openai|anthropic|ollama]');
    process.exit(1);
  }

  const backfillTarget = parseFlag(args, '--target');
  if (!backfillTarget) {
    console.error('  --target=<target> is required');
    process.exit(1);
  }

  const def = readNodeDefinition(backfillKeyword);
  if (!def) {
    console.error(`  Node '${backfillKeyword}' is not graduated.`);
    process.exit(1);
  }

  const codegenTsPath = resolve('.kern', 'evolved', backfillKeyword, 'codegen.ts');
  if (!existsSync(codegenTsPath)) {
    console.error(`  Missing codegen.ts for '${backfillKeyword}'`);
    process.exit(1);
  }
  const codegenSource = readFileSync(codegenTsPath, 'utf-8');
  const templateKernPath = resolve('.kern', 'evolved', backfillKeyword, 'template.kern');
  const kernExample = existsSync(templateKernPath) ? readFileSync(templateKernPath, 'utf-8') : '';
  const expectedOutputPath = resolve('.kern', 'evolved', backfillKeyword, 'expected-output.ts');
  const expectedOutput = existsSync(expectedOutputPath) ? readFileSync(expectedOutputPath, 'utf-8') : '';

  console.log(`\n  KERN evolve:backfill — ${backfillKeyword} → ${backfillTarget}\n`);

  const providerArg = parseFlag(args, '--provider') as 'openai' | 'anthropic' | 'ollama' | undefined;
  let provider;
  try {
    provider = createLLMProvider({ provider: providerArg });
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`  Provider: ${provider.name}`);

  const prompt = buildBackfillPrompt(
    backfillKeyword,
    {
      props: def.props,
      childTypes: def.childTypes,
      kernExample,
      codegenSource,
      expectedOutput,
    },
    backfillTarget,
  );

  try {
    const response = await provider.complete(prompt);

    const parsed = parseLLMJsonObject(response);
    if (!parsed) {
      console.error('  LLM response is not a valid JSON object');
      process.exit(1);
    }

    const validated = validateBackfillResponse(parsed);
    if (!validated) {
      console.error('  LLM did not return codegenSource');
      process.exit(1);
    }

    const targetsDir = resolve('.kern', 'evolved', backfillKeyword, 'targets');
    mkdirSync(targetsDir, { recursive: true });
    writeFileSync(resolve(targetsDir, `${backfillTarget}.js`), validated.codegenSource);

    console.log(`  Written: .kern/evolved/${backfillKeyword}/targets/${backfillTarget}.js`);
    if (validated.expectedOutput) {
      console.log(`  Expected output preview:`);
      for (const line of validated.expectedOutput.split('\n').slice(0, 10)) {
        console.log(`    ${line}`);
      }
    }
    console.log(`\n  Review the generated codegen before using in production.`);
  } catch (err) {
    console.error(`  Error: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log('');
  process.exit(0);
}
