import crypto from 'node:crypto';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { stringifyCanonical } from './artifact-types.mjs';

const ARTIFACT_ID_RE = /^[1-9][0-9]*$/;
const ARTIFACT_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function sha512Hex(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('hex');
}

async function regularFileBytes(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} is missing`);
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  return readFile(filePath);
}

export function receiptPath(rootDir, kind) {
  if (kind !== 'bundle' && kind !== 'snapshot') {
    throw new Error(`Unsupported durability receipt kind: ${kind}`);
  }
  return path.join(rootDir, '.release', `${kind}-durability-receipt.json`);
}

export async function contentDigestFor({ kind, contentPath }) {
  const bytes = await regularFileBytes(
    contentPath,
    kind === 'bundle' ? 'release-bundle.json' : 'promotion snapshot',
  );
  return `sha512:${sha512Hex(bytes)}`;
}

export async function writeDurabilityReceipt({
  rootDir,
  kind,
  artifactName,
  artifactId,
  artifactDigest,
  contentPath,
  plan,
  source,
}) {
  if (!ARTIFACT_ID_RE.test(String(artifactId))) {
    throw new Error(`Invalid durable artifact id: ${artifactId}`);
  }
  if (artifactDigest !== null && !ARTIFACT_DIGEST_RE.test(artifactDigest)) {
    throw new Error(`Invalid durable artifact digest: ${artifactDigest}`);
  }
  if (source !== 'uploaded' && source !== 'recovered') {
    throw new Error(`Invalid durability receipt source: ${source}`);
  }
  const receipt = {
    schemaVersion: 1,
    kind,
    artifactName,
    artifactId: String(artifactId),
    artifactDigest,
    source,
    sha: plan.sha,
    version: plan.version,
    contentSha512: await contentDigestFor({ kind, contentPath }),
  };
  const finalPath = receiptPath(rootDir, kind);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, stringifyCanonical(receipt), { mode: 0o600 });
  await rename(tempPath, finalPath);
  return receipt;
}

export async function validateDurabilityReceipt({
  rootDir,
  kind,
  artifactName,
  contentPath,
  plan,
}) {
  const filePath = receiptPath(rootDir, kind);
  const receipt = JSON.parse((await regularFileBytes(filePath, `${kind} durability receipt`)).toString('utf8'));
  const expectedDigest = await contentDigestFor({ kind, contentPath });
  const valid =
    receipt.schemaVersion === 1 &&
    receipt.kind === kind &&
    receipt.artifactName === artifactName &&
    ARTIFACT_ID_RE.test(String(receipt.artifactId)) &&
    (receipt.artifactDigest === null || ARTIFACT_DIGEST_RE.test(receipt.artifactDigest)) &&
    (receipt.source === 'uploaded' || receipt.source === 'recovered') &&
    receipt.sha === plan.sha &&
    receipt.version === plan.version &&
    receipt.contentSha512 === expectedDigest;
  if (!valid) {
    throw new Error(`${kind} durability receipt does not match the current release content`);
  }
  return receipt;
}
