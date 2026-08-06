import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateScalarSafeCorpus } from '../check-kern-frontend-tokenizer.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function fail(detail) {
  throw new Error(`frontend stitcher corpus rejection: ${detail}`);
}

export function resolveStitcherCorpusPath(entryPath, repositoryRoot = DEFAULT_ROOT) {
  const examplesRoot = realpathSync(resolve(repositoryRoot, 'examples'));
  const candidate = realpathSync(resolve(repositoryRoot, entryPath));
  const contained = relative(examplesRoot, candidate);
  if (contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    fail('corpus path must resolve beneath examples');
  }
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('corpus path must be a regular file');
  return candidate;
}

export function corpusDocuments(policy, repositoryRoot = DEFAULT_ROOT) {
  return policy.corpus.map((entry) => {
    const path = resolveStitcherCorpusPath(entry.path, repositoryRoot);
    const bytes = readFileSync(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256) fail(`${entry.path} digest changed`);
    const source = bytes.toString('utf8');
    if (source.includes('\r')) fail(`${entry.path} must use LF line endings`);
    const lines = source.split('\n');
    if (lines.length < entry.maxLines) fail(`${entry.path} supplies fewer than ${entry.maxLines} lines`);
    const selectedLines = validateScalarSafeCorpus(lines.slice(0, entry.maxLines));
    const selected = selectedLines.join('\n');
    if (Buffer.byteLength(selected) > policy.profileLimits.maxSourceBytes) {
      fail(`${entry.path} selected prefix exceeds maxSourceBytes`);
    }
    return { id: entry.path, source: selected };
  });
}
