import fs from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultArtifactStore } from './artifact-store.mjs';
import { deriveBundleName } from './bundle.mjs';
import { writeDurabilityReceipt } from './durability.mjs';
import { DefaultJournalSink } from './journal.mjs';
import { packArtifacts } from './pack-artifacts.mjs';
import { createReleasePlan } from './plan.mjs';
import { loadReleasePolicy } from './policy.mjs';
import { deriveSnapshotName } from './promotion.mjs';
import { DefaultRegistryClient } from './registry-client.mjs';
import { runReleaseWorkflow } from './registry-reconciler.mjs';

const MODES = new Set([
  'preflight',
  'publish-pack',
  'confirm-bundle',
  'publish-reconcile',
  'publish-snapshot',
  'confirm-snapshot',
  'publish-promote',
  'publish-smoke',
]);
const OPTION_NAMES = new Map([
  ['--channel', 'channel'],
  ['--version', 'version'],
  ['--sha', 'sha'],
  ['--run-number', 'runNumber'],
  ['--mode', 'mode'],
  ['--journal', 'journal'],
  ['--artifact-id', 'artifactId'],
  ['--artifact-digest', 'artifactDigest'],
  ['--tag', 'tag'],
]);

export function parseCliArgs(args) {
  if (args.length % 2 !== 0) throw new Error(`Missing value for option: ${args.at(-1)}`);
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const key = OPTION_NAMES.get(flag);
    if (!key) throw new Error(`Unknown option: ${flag}`);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for option: ${flag}`);
    options[key] = value;
  }
  if (!MODES.has(options.mode)) throw new Error('Missing or invalid required option: --mode');
  for (const key of ['channel', 'sha']) {
    if (!options[key]) throw new Error(`Missing required option: --${key}`);
  }
  if (options.mode.startsWith('confirm-') && (!options.artifactId || !options.artifactDigest)) {
    throw new Error('Confirmation modes require --artifact-id and --artifact-digest');
  }
  return options;
}

async function writeOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
  await appendFile(process.env.GITHUB_OUTPUT, lines, 'utf8');
}

function normalizedArtifactDigest(value) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const policy = await loadReleasePolicy(path.join(rootDir, 'scripts/release/release-policy.json'));
  const plan = await createReleasePlan({
    rootDir,
    policy,
    channel: options.channel,
    version: options.version,
    sha: options.sha,
    runNumber: options.runNumber,
  });
  const releaseDir = path.join(rootDir, '.release');
  const bundleDir = path.join(releaseDir, 'bundle');
  const tarballDir = path.join(releaseDir, 'artifacts');
  await mkdir(releaseDir, { recursive: true });
  const bundleName = deriveBundleName({ plan, policy });
  const snapshotName = deriveSnapshotName(plan);
  if (options.tag !== undefined && options.tag !== plan.distTag) {
    throw new Error(`Requested tag ${options.tag} does not match release plan tag ${plan.distTag}`);
  }

  if (options.mode === 'confirm-bundle' || options.mode === 'confirm-snapshot') {
    const kind = options.mode === 'confirm-bundle' ? 'bundle' : 'snapshot';
    const artifactName = kind === 'bundle' ? bundleName : snapshotName;
    const contentPath = kind === 'bundle'
      ? path.join(bundleDir, 'release-bundle.json')
      : path.join(releaseDir, `${snapshotName}.json`);
    await writeDurabilityReceipt({
      rootDir,
      kind,
      artifactName,
      artifactId: options.artifactId,
      artifactDigest: normalizedArtifactDigest(options.artifactDigest),
      contentPath,
      plan,
      source: 'uploaded',
    });
    return;
  }

  const registryClient = new DefaultRegistryClient({
    registryUrl: policy.registry.url,
    timeoutMs: policy.registry.timeoutMs,
    mutationTimeoutMs: policy.registry.mutationTimeoutMs,
    maxOutputBytes: policy.artifacts.maxCommandOutputBytes,
    clientCommand: policy.registry.clientCommand,
    provenanceMode: policy.provenance.mode,
  });
  const artifactStore = new DefaultArtifactStore({
    rootDir,
    limits: policy.bundle,
  });
  const journal = await DefaultJournalSink.open({
    journalPath: options.journal
      ? path.resolve(rootDir, options.journal)
      : path.join(releaseDir, 'journal.json'),
    plan,
    bundleName,
    bundleDigest: null,
  });
  try {
    const result = await runReleaseWorkflow({
      rootDir,
      plan,
      policy,
      bundleDir,
      tarballDir,
      registryClient,
      artifactStore,
      clock: {
        now: () => new Date(),
        sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      },
      journal,
      packArtifactsFn: packArtifacts,
      mode: options.mode,
    });
    if (options.mode === 'publish-pack') {
      await writeOutputs({
        created: result.created,
        'artifact-name': result.bundleName,
        'retention-days': policy.bundle.retentionDays,
      });
    }
    if (options.mode === 'publish-snapshot') {
      await writeOutputs({
        created: result.created,
        'artifact-name': result.artifactName,
        'retention-days': policy.bundle.retentionDays,
      });
    }
  } catch (error) {
    await journal.writeEvent({
      phase: options.mode,
      packageName: null,
      operation: 'phase',
      outcome: 'failed',
      error: new Error(`${options.mode} failed`),
    });
    await journal.setFinalState('failed');
    throw error;
  }
}

let isMain = false;
try {
  isMain = Boolean(process.argv[1]) &&
    fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch {}

if (isMain) {
  main().catch((error) => {
    console.error(`Registry reconciler workflow failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}
