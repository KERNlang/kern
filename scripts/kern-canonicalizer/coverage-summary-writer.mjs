import { randomUUID } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function outputPath(summaryUrl) {
  return summaryUrl instanceof URL ? fileURLToPath(summaryUrl) : summaryUrl;
}

function summaryBytes(summary) {
  return Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
}

export function assertCoverageSummary(summaryUrl, summary) {
  const path = outputPath(summaryUrl);
  const source = lstatSync(path, { throwIfNoEntry: false });
  if (source === undefined || !source.isFile()) {
    throw new TypeError('coverage summary source must be a regular file');
  }
  if (!readFileSync(path).equals(summaryBytes(summary))) {
    throw new TypeError('coverage summary source must contain canonical bytes');
  }
}

export function writeCoverageSummary(summaryUrl, summary) {
  const path = outputPath(summaryUrl);
  const destination = lstatSync(path, { throwIfNoEntry: false });
  if (destination !== undefined && !destination.isFile()) {
    throw new TypeError('coverage summary destination must be a regular file');
  }
  const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const descriptor = openSync(temporaryPath, 'wx', 0o644);
    try {
      writeFileSync(descriptor, summaryBytes(summary));
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}
