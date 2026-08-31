import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { loadReleasePolicy } from './policy.mjs';
import { createReleasePlan } from './plan.mjs';

const OPTION_NAMES = new Map([
  ['--channel', 'channel'],
  ['--version', 'version'],
  ['--sha', 'sha'],
  ['--run-number', 'runNumber'],
]);

export function parseCliArgs(args) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = OPTION_NAMES.get(flag);
    if (!key) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate option: ${flag}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for option: ${flag}`);
    }
    options[key] = value;
  }
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const policyPath = path.join(repoRoot, 'scripts/release/release-policy.json');
  const policy = await loadReleasePolicy(policyPath);

  const plan = await createReleasePlan({
    rootDir: repoRoot,
    policy,
    channel: options.channel,
    version: options.version,
    sha: options.sha,
    runNumber: options.runNumber,
  });

  console.log(JSON.stringify(plan, null, 2));

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `version=${plan.version}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `channel=${plan.channel}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `dist_tag=${plan.distTag}\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `packages=${JSON.stringify(plan.packages)}\n`);
  }

  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `CANARY_VERSION=${plan.version}\n`);
    await appendFile(process.env.GITHUB_ENV, `NPM_TAG=${plan.distTag}\n`);
    await appendFile(process.env.GITHUB_ENV, `DIST_TAG=${plan.distTag}\n`);
    await appendFile(process.env.GITHUB_ENV, `RELEASE_VERSION=${plan.version}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
