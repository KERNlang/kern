import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARKDOWN_SUFFIX = '.md';
const EXCLUDED_PATH_PATTERNS = [
  /^\.Codex\/specs\//u,
  /^examples\//u,
  /^docs\//u,
  /^scripts\//u,
  /^packages\//u,
  /^\.github\//u,
];
const SAFE_REF = /^[\w.][\w.\-/]*$/u;

function isDocsPath(candidate, references) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const basename = candidate.slice(candidate.lastIndexOf('/') + 1);
  if (!basename.endsWith(MARKDOWN_SUFFIX) || basename.length === MARKDOWN_SUFFIX.length) return false;
  if (EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(candidate))) return false;
  if (typeof references === 'function' && references(candidate)) return false;
  return true;
}

export function classifyChanges({ eventName, baseRef, files, references }) {
  if (eventName !== 'pull_request') return 'FULL';
  if (typeof baseRef !== 'string' || baseRef.length === 0) return 'FULL';
  if (!Array.isArray(files) || files.length === 0) return 'FULL';
  for (const file of files) {
    const sides = [file?.oldPath, file?.newPath].filter(
      (side) => typeof side === 'string' && side.length > 0,
    );
    if (sides.length === 0) return 'FULL';
    if (!sides.every((side) => isDocsPath(side, references))) return 'FULL';
  }
  return 'DOCS_ONLY';
}

export function parseNameStatus(output) {
  const fields = output.split('\0').filter((field) => field.length > 0);
  const files = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    index += 1;
    if (status.startsWith('R') || status.startsWith('C')) {
      files.push({ status, oldPath: fields[index], newPath: fields[index + 1] });
      index += 2;
      continue;
    }
    const changed = fields[index];
    index += 1;
    files.push({
      status,
      oldPath: status === 'A' ? undefined : changed,
      newPath: status === 'D' ? undefined : changed,
    });
  }
  return files;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe' });
}

function referencesTrackedFile(candidate) {
  const basename = candidate.slice(candidate.lastIndexOf('/') + 1);
  try {
    const hits = git('grep', '-l', '-I', '-F', '-e', candidate, '-e', basename, '--', ':!*.md');
    return hits.trim().length > 0;
  } catch (error) {
    return error?.status !== 1;
  }
}

export function classifyFromGit({ eventName, baseSha, references = referencesTrackedFile }) {
  if (eventName !== 'pull_request') return 'FULL';
  if (typeof baseSha !== 'string' || !SAFE_REF.test(baseSha)) return 'FULL';
  git('fetch', '--no-tags', '--quiet', '--depth=1', 'origin', baseSha);
  const files = parseNameStatus(git('diff', '--name-status', '-z', '-M', baseSha, 'HEAD'));
  return classifyChanges({ eventName, baseRef: baseSha, files, references });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let ciClass = 'FULL';
  try {
    ciClass = classifyFromGit({
      eventName: process.env.GITHUB_EVENT_NAME,
      baseSha: process.env.GITHUB_BASE_SHA,
    });
  } catch (error) {
    process.stderr.write(`classify-ci-changes failed closed to FULL: ${error?.message ?? error}\n`);
    ciClass = 'FULL';
  }
  if (ciClass !== 'DOCS_ONLY' && ciClass !== 'FULL') ciClass = 'FULL';
  try {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ci_class=${ciClass}\n`);
  } catch (error) {
    process.stderr.write(`classify-ci-changes could not write GITHUB_OUTPUT: ${error?.message ?? error}\n`);
  }
  process.stderr.write(`ci_class=${ciClass}\n`);
  process.exit(0);
}
