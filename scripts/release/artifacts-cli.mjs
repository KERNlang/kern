import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { constructManifest } from './artifact-manifest.mjs';
import { stringifyCanonical } from './artifact-types.mjs';
import { verifyOfflineConsumer } from './offline-consumer.mjs';
import { packArtifacts } from './pack-artifacts.mjs';
import { validateReleasePlan } from './plan.mjs';
import { loadReleasePolicy } from './policy.mjs';

export function parseArtifactArgs(args) {
  const allowedFlags = new Set([
    '--plan',
    '--out',
    '--manifest',
    '--offline-consumer-test',
    '--keep-temp',
  ]);

  const parsed = {
    plan: undefined,
    out: undefined,
    manifest: undefined,
    offlineConsumerTest: false,
    keepTemp: false,
  };

  const seenFlags = new Set();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!allowedFlags.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (seenFlags.has(arg)) {
      throw new Error(`Duplicate option: ${arg}`);
    }
    seenFlags.add(arg);

    if (arg === '--offline-consumer-test') {
      parsed.offlineConsumerTest = true;
    } else if (arg === '--keep-temp') {
      parsed.keepTemp = true;
    } else {
      if (i + 1 >= args.length) {
        throw new Error(`Missing value for flag ${arg}`);
      }
      const nextArg = args[i + 1];
      if (nextArg.startsWith('--')) {
        throw new Error(`Missing value for flag ${arg}`);
      }
      const val = nextArg;
      i++;
      if (arg === '--plan') {
        parsed.plan = val;
      } else if (arg === '--out') {
        parsed.out = val;
      } else if (arg === '--manifest') {
        parsed.manifest = val;
      }
    }
  }

  if (parsed.plan === undefined) {
    throw new Error('Missing required flag: --plan');
  }
  if (parsed.out === undefined) {
    throw new Error('Missing required flag: --out');
  }
  if (parsed.manifest === undefined) {
    throw new Error('Missing required flag: --manifest');
  }

  return parsed;
}

export async function runArtifactWall(options) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const absoluteOut = path.resolve(repoRoot, options.out);
  const absoluteManifest = path.resolve(repoRoot, options.manifest);
  const relativePath = path.relative(absoluteOut, absoluteManifest);
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    throw new Error('Manifest path must be outside the artifact directory');
  }

  const policyPath = path.join(repoRoot, 'scripts/release/release-policy.json');
  const policy = await loadReleasePolicy(policyPath);

  const planPath = path.resolve(repoRoot, options.plan);
  if (planPath === absoluteManifest) {
    throw new Error('Manifest path cannot overwrite the release plan');
  }
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  validateReleasePlan(plan, policy);

  const packedInfo = await packArtifacts({
    plan,
    outDir: options.out,
    rootDir: repoRoot,
    limits: policy.artifacts,
  });

  const manifest = constructManifest({ plan, packedInfo });

  if (options.offlineConsumerTest) {
    await verifyOfflineConsumer({
      manifest,
      outDir: options.out,
      rootDir: repoRoot,
      limits: policy.artifacts,
      safeBins: policy.artifacts.safeBins,
      consumerBuiltDependencies: policy.artifacts.consumerBuiltDependencies,
      importSmokeExclusions: policy.artifacts.importSmokeExclusions,
      keepTemp: options.keepTemp,
    });
  }

  const manifestDir = path.dirname(absoluteManifest);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(absoluteManifest, stringifyCanonical(manifest));
  return manifest;
}

async function main() {
  await runArtifactWall(parseArtifactArgs(process.argv.slice(2)));
}

let isMain = false;
try {
  if (process.argv[1]) {
    const mainPath = fs.realpathSync(process.argv[1]);
    const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
    isMain = mainPath === modulePath;
  }
} catch {
  // Entry-point detection must never crash the CLI: unreadable argv/module
  // paths mean this is not the executed entry module.
  isMain = false;
}

if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
