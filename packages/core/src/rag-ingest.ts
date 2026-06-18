import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { RagChunkInput } from './rag-runtime.js';
import { collectRagSemanticFacts, type RagSemanticFacts, type RagSemanticSourceFact } from './semantic-validator.js';
import type { IRNode } from './types.js';

export const RAG_CHUNK_ID_VERSION = 'kern-rag-chunk-v1';
export const RAG_TOKEN_WINDOW_CHUNKER_VERSION = 'token-window-v1';
export const RAG_SEMANTIC_CHUNKER_VERSION = 'semantic-boundary-v1';
export const RAG_CHUNKER_VERSION = RAG_TOKEN_WINDOW_CHUNKER_VERSION;

export interface RagIngestOptions {
  readonly sourcePath: string;
  readonly corpusNames?: readonly string[];
}

export interface RagIngestedSource {
  readonly corpusName: string;
  readonly sourceName?: string;
  readonly uri: string;
  readonly rootDir: string;
  readonly files: readonly string[];
}

export interface RagIngestResult {
  readonly chunks: readonly RagChunkInput[];
  readonly sources: readonly RagIngestedSource[];
  readonly corpusSha256: string;
}

interface ChunkingConfig {
  readonly strategy: 'semantic' | 'window';
  readonly maxTokens: number;
  readonly overlap: number;
  readonly unit: 'tokens' | 'chars';
  readonly version: string;
}

interface TokenSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface FenceMarker {
  readonly kind: '`' | '~';
  readonly length: number;
}

export function ingestRagDeclaredLocalSources(root: IRNode, options: RagIngestOptions): RagIngestResult {
  const facts = collectRagSemanticFacts(root);
  return ingestRagFactsDeclaredLocalSources(facts, options);
}

export function ingestRagFactsDeclaredLocalSources(
  facts: RagSemanticFacts,
  options: RagIngestOptions,
): RagIngestResult {
  const specPath = resolve(options.sourcePath);
  const baseDir = dirname(specPath);
  const specRealPath = realpathSync(specPath);
  const baseRealPath = realpathSync(baseDir);
  const chunks: RagChunkInput[] = [];
  const sources: RagIngestedSource[] = [];
  const corpusNames = options.corpusNames === undefined ? undefined : new Set(options.corpusNames);

  for (const corpus of facts.corpora) {
    if (corpusNames !== undefined && !corpusNames.has(corpus.name)) continue;
    for (const source of corpus.sources) {
      if (!isLocalSource(source)) continue;
      const sourceName = source.name ?? basename(source.uri);
      const files = resolveSourceFiles(source, baseDir, baseRealPath, specRealPath);
      const chunking = chunkingForSource(facts, corpus.name, source.name);
      const sourceRecord: RagIngestedSource = {
        corpusName: corpus.name,
        sourceName,
        uri: source.uri,
        rootDir: baseDir,
        files,
      };
      sources.push(sourceRecord);

      for (const filePath of files) {
        const raw = readContainedUtf8File(filePath, baseRealPath);
        const text = normalizeSourceText(raw);
        if (!text.trim()) continue;
        const relPath = normalizePath(relative(baseDir, filePath));
        const sourceHash = sha256(text);
        const windows = chunkText(text, chunking);
        windows.forEach((window, chunkIndex) => {
          const idHash = sha256(
            [
              RAG_CHUNK_ID_VERSION,
              corpus.name,
              sourceName,
              relPath,
              sourceHash,
              String(chunkIndex),
              String(window.start),
              String(window.end),
              window.text,
            ].join('\n'),
          );
          chunks.push({
            id: `${sourceName}:${idHash.slice(0, 24)}`,
            text: window.text,
            source: relPath,
            citation: { uri: relPath, locator: `chars:${window.start}-${window.end}` },
            metadata: {
              chunkIdVersion: RAG_CHUNK_ID_VERSION,
              chunkerVersion: chunking.version,
              chunkingStrategy: chunking.strategy,
              corpusName: corpus.name,
              sourceName,
              sourceUri: source.uri,
              sourcePath: filePath,
              relativePath: relPath,
              sourceContentSha256: sourceHash,
              chunkIndex,
              start: window.start,
              end: window.end,
            },
          });
        });
      }
    }
  }

  if (sources.length === 0) {
    throw new Error(
      'KERN RAG declared-source ingestion found no local corpus sources. Add source kind=local uri=... or pass --corpus <chunks.json>.',
    );
  }
  if (chunks.length === 0) {
    throw new Error('KERN RAG declared-source ingestion produced no chunks from the matched local sources.');
  }

  return {
    chunks,
    sources,
    corpusSha256: sha256(stableChunkHashInput(chunks)),
  };
}

function stableChunkHashInput(chunks: readonly RagChunkInput[]): string {
  return chunks
    .map((chunk) => `${chunk.id}\0${chunk.source}\0${chunk.text}`)
    .sort()
    .join('\n');
}

function isLocalSource(source: RagSemanticSourceFact): boolean {
  return source.uri.trim() !== '' && (source.kind === undefined || source.kind === 'local');
}

function resolveSourceFiles(
  source: RagSemanticSourceFact,
  baseDir: string,
  baseRealPath: string,
  specRealPath: string,
): string[] {
  const pattern = normalizePattern(source.uri);
  const root = globSearchRoot(baseDir, pattern);
  if (!existsSync(root)) {
    throw new Error(
      `KERN RAG source '${source.name ?? source.uri}' glob '${source.uri}' matched no files from ${baseDir}.`,
    );
  }
  if (lstatSync(root).isSymbolicLink() || !isPathInside(realpathSync(root), baseRealPath)) {
    throw new Error(
      `KERN RAG source '${source.name ?? source.uri}' glob '${source.uri}' must stay within the declaring .kern file directory.`,
    );
  }
  const matcher = globMatcher(pattern);
  const files = walkFiles(root)
    .filter((filePath) => matcher(normalizePath(relative(baseDir, filePath))))
    .map((filePath) => resolve(filePath))
    .sort((a, b) => compareCodePoint(normalizePath(relative(baseDir, a)), normalizePath(relative(baseDir, b))));

  if (files.length === 0) {
    throw new Error(
      `KERN RAG source '${source.name ?? source.uri}' glob '${source.uri}' matched no files from ${baseDir}.`,
    );
  }

  const unique = Array.from(new Set(files));
  const realPaths = unique.map((filePath) => realpathSync(filePath));
  if (realPaths.some((filePath) => !isPathInside(filePath, baseRealPath))) {
    throw new Error(
      `KERN RAG source '${source.name ?? source.uri}' glob '${source.uri}' must stay within the declaring .kern file directory.`,
    );
  }
  if (realPaths.some((filePath) => filePath === specRealPath)) {
    throw new Error(
      `KERN RAG source '${source.name ?? source.uri}' would ingest the declaring .kern file; narrow uri='${source.uri}'.`,
    );
  }
  return unique;
}

function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim();
  const normalized = normalizePath(trimmed);
  if (isUnsafeLocalPattern(trimmed, normalized)) {
    throw new Error(
      `KERN RAG local source uri '${pattern}' must stay within the declaring .kern file directory; absolute paths and '..' segments are not allowed.`,
    );
  }
  return normalized.replace(/^\.\//u, '');
}

function isUnsafeLocalPattern(rawPattern: string, normalizedPattern: string): boolean {
  if (isAbsolute(rawPattern) || normalizedPattern.startsWith('/') || /^[A-Za-z]:\//u.test(normalizedPattern)) {
    return true;
  }
  return normalizedPattern.split('/').includes('..');
}

function globSearchRoot(baseDir: string, pattern: string): string {
  const wildcardIndex = pattern.search(/[*?[]/u);
  if (wildcardIndex === -1) {
    return resolve(baseDir, dirname(pattern));
  }
  const prefix = pattern.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf('/');
  return resolve(baseDir, slashIndex === -1 ? '.' : prefix.slice(0, slashIndex));
}

function globMatcher(pattern: string): (relativePath: string) => boolean {
  const regex = new RegExp(`^${globToRegex(pattern)}$`, 'u');
  return (relativePath) => regex.test(relativePath);
}

function globToRegex(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    const after = pattern[i + 2];
    if (ch === '*' && next === '*' && after === '/') {
      out += '(?:.*/)?';
      i += 2;
    } else if (ch === '*' && next === '*') {
      out += '.*';
      i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const closeIndex = pattern.indexOf(']', i + 1);
      if (closeIndex === -1) {
        out += '\\[';
      } else {
        const body = pattern.slice(i + 1, closeIndex);
        out += globCharClassToRegex(body);
        i = closeIndex;
      }
    } else {
      out += escapeRegexChar(ch);
    }
  }
  return out;
}

function globCharClassToRegex(body: string): string {
  if (body === '' || body === '!') return `\\[${escapeRegexChar(body)}\\]`;
  const negate = body[0] === '!';
  const raw = negate ? body.slice(1) : body;
  const escaped = raw.replace(/\\/gu, '\\\\').replace(/\]/gu, '\\]').replace(/^\^/u, '\\^');
  return `[${negate ? '^' : ''}${escaped}]`;
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeRegexChar(ch: string): string {
  return /[.+^${}()|[\]\\]/u.test(ch) ? `\\${ch}` : ch;
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visitedDirs = new Set<string>();
  const visit = (dir: string): void => {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    const realDir = realpathSync(dir);
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.kern') continue;
      const full = resolve(dir, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) files.push(full);
    }
  };
  visit(root);
  return files;
}

function chunkingForSource(facts: RagSemanticFacts, corpusName: string, sourceName?: string): ChunkingConfig {
  const corpus = facts.corpora.find((entry) => entry.name === corpusName);
  const chunking =
    corpus?.chunking.find((entry) => sourceName && entry.sourceName === sourceName) ??
    corpus?.chunking.find((entry) => !entry.sourceName);
  const unit = chunking?.unit === 'chars' ? 'chars' : 'tokens';
  const declaredStrategy = chunking?.strategy;
  if (
    declaredStrategy !== undefined &&
    declaredStrategy !== 'semantic' &&
    declaredStrategy !== 'window' &&
    declaredStrategy !== 'token' &&
    declaredStrategy !== 'token-window'
  ) {
    throw new Error("KERN RAG chunking strategy must be one of 'semantic', 'window', 'token', or 'token-window'.");
  }
  if (declaredStrategy === 'semantic' && unit === 'chars') {
    throw new Error('KERN RAG semantic chunking currently requires unit=tokens; omit unit or set unit=tokens.');
  }
  const strategy = declaredStrategy === 'semantic' ? 'semantic' : 'window';
  const maxTokens = Math.max(1, chunking?.maxTokens ?? 512);
  const overlap = Math.max(0, chunking?.overlap ?? 0);
  return {
    strategy,
    maxTokens,
    overlap: overlap >= maxTokens ? 0 : overlap,
    unit,
    version: strategy === 'semantic' ? RAG_SEMANTIC_CHUNKER_VERSION : RAG_TOKEN_WINDOW_CHUNKER_VERSION,
  };
}

function normalizeSourceText(text: string): string {
  return text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
}

function chunkText(text: string, config: ChunkingConfig): TokenSpan[] {
  if (config.strategy === 'semantic') return chunkBySemanticBoundaries(text, config.maxTokens, config.overlap);
  if (config.unit === 'chars') return chunkByChars(text, config.maxTokens, config.overlap);
  return chunkByTokens(text, config.maxTokens, config.overlap);
}

function chunkBySemanticBoundaries(text: string, maxTokens: number, overlapTokens: number): TokenSpan[] {
  return splitByMarkdownSections(text).flatMap((section) => {
    if (countTokens(section.text) <= maxTokens) return [section];
    const units = splitByParagraphs(section).flatMap((paragraph) =>
      splitOversizedSemanticUnit(paragraph, maxTokens, overlapTokens),
    );
    return packSemanticUnits(text, units, maxTokens, overlapTokens);
  });
}

function packSemanticUnits(
  text: string,
  units: readonly TokenSpan[],
  maxTokens: number,
  overlapTokens: number,
): TokenSpan[] {
  const chunks: TokenSpan[] = [];
  let startIndex = 0;
  while (startIndex < units.length) {
    let endIndex = startIndex;
    let tokenCount = 0;
    while (endIndex < units.length) {
      const nextCount = countTokens(units[endIndex].text);
      if (endIndex > startIndex && tokenCount + nextCount > maxTokens) break;
      tokenCount += nextCount;
      endIndex += 1;
      if (tokenCount >= maxTokens) break;
    }

    const start = units[startIndex].start;
    const end = units[endIndex - 1].end;
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push({ text: chunk, start, end });
    if (endIndex >= units.length) break;

    const overlappedStart = overlapStartIndex(units, startIndex, endIndex, overlapTokens);
    startIndex = overlappedStart > startIndex ? overlappedStart : endIndex;
  }

  return chunks;
}

function splitByMarkdownSections(text: string): TokenSpan[] {
  const sections: TokenSpan[] = [];
  const lines = lineSpans(text);
  let sectionStart: number | undefined;
  let sectionEnd = 0;
  let activeFence: FenceMarker | undefined;

  for (const line of lines) {
    const openingFence = activeFence === undefined ? parseOpeningFence(line.text) : undefined;
    const closingFence = activeFence !== undefined && isClosingFenceLine(line.text, activeFence);
    if (activeFence === undefined && openingFence === undefined && isMarkdownHeading(line.text)) {
      if (sectionStart !== undefined && sectionEnd > sectionStart) {
        pushTrimmedSpan(sections, text, sectionStart, sectionEnd);
      }
      sectionStart = line.start;
    } else if (sectionStart === undefined && line.text.trim() !== '') {
      sectionStart = line.start;
    }
    sectionEnd = line.end;
    if (openingFence !== undefined) activeFence = openingFence;
    else if (closingFence) activeFence = undefined;
  }

  if (sectionStart !== undefined && sectionEnd > sectionStart)
    pushTrimmedSpan(sections, text, sectionStart, sectionEnd);
  return sections;
}

function splitByParagraphs(section: TokenSpan): TokenSpan[] {
  const units: TokenSpan[] = [];
  const lines = lineSpans(section.text);
  let start: number | undefined;
  let end = 0;
  let activeFence: FenceMarker | undefined;

  for (const line of lines) {
    const absoluteStart = section.start + line.start;
    const absoluteEnd = section.start + line.end;
    const openingFence = activeFence === undefined ? parseOpeningFence(line.text) : undefined;
    const closingFence = activeFence !== undefined && isClosingFenceLine(line.text, activeFence);
    if (start === undefined && line.text.trim() !== '') start = absoluteStart;
    if (activeFence === undefined && openingFence === undefined && line.text.trim() === '') {
      if (start !== undefined && end > start)
        pushTrimmedSpan(units, section.text, start - section.start, end - section.start, section.start);
      start = undefined;
    } else {
      end = absoluteEnd;
    }
    if (openingFence !== undefined) activeFence = openingFence;
    else if (closingFence) activeFence = undefined;
  }

  if (start !== undefined && end > start)
    pushTrimmedSpan(units, section.text, start - section.start, end - section.start, section.start);
  return units;
}

function splitOversizedSemanticUnit(unit: TokenSpan, maxTokens: number, overlapTokens: number): TokenSpan[] {
  if (countTokens(unit.text) <= maxTokens) return [unit];
  if (isFencedBlock(unit.text)) return [unit];
  const sentences = splitBySentences(unit);
  if (sentences.length > 1) {
    return sentences.flatMap((sentence) =>
      countTokens(sentence.text) <= maxTokens ? [sentence] : offsetTokenChunks(sentence, maxTokens, overlapTokens),
    );
  }
  return offsetTokenChunks(unit, maxTokens, overlapTokens);
}

function splitBySentences(unit: TokenSpan): TokenSpan[] {
  const out: TokenSpan[] = [];
  let start = 0;
  for (let i = 0; i < unit.text.length; i += 1) {
    const ch = unit.text[i];
    const next = unit.text[i + 1];
    if ((ch === '.' || ch === '!' || ch === '?') && (next === undefined || /\s/u.test(next))) {
      pushTrimmedSpan(out, unit.text, start, i + 1, unit.start);
      start = i + 1;
    }
  }
  pushTrimmedSpan(out, unit.text, start, unit.text.length, unit.start);
  return out;
}

function offsetTokenChunks(unit: TokenSpan, maxTokens: number, overlapTokens: number): TokenSpan[] {
  return chunkByTokens(unit.text, maxTokens, overlapTokens).map((chunk) => ({
    text: chunk.text,
    start: unit.start + chunk.start,
    end: unit.start + chunk.end,
  }));
}

function overlapStartIndex(
  units: readonly TokenSpan[],
  startIndex: number,
  endIndex: number,
  overlapTokens: number,
): number {
  if (overlapTokens <= 0) return endIndex;
  let count = 0;
  for (let index = endIndex - 1; index > startIndex; index -= 1) {
    const unitTokens = countTokens(units[index].text);
    if (count + unitTokens > overlapTokens) return count === 0 ? index : index + 1;
    count += unitTokens;
  }
  return endIndex - 1;
}

function lineSpans(text: string): TokenSpan[] {
  const lines: TokenSpan[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      lines.push({ text: text.slice(start, i + 1), start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < text.length) lines.push({ text: text.slice(start), start, end: text.length });
  return lines;
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s+\S/u.test(line.trimStart());
}

function parseOpeningFence(line: string): FenceMarker | undefined {
  const match = /^\s*(`{3,}|~{3,})/u.exec(line);
  if (match === null) return undefined;
  return { kind: match[1][0] === '`' ? '`' : '~', length: match[1].length };
}

function isClosingFenceLine(line: string, marker: FenceMarker): boolean {
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  const expected = marker.kind.repeat(trimmed.length);
  return trimmed === expected;
}

function isFencedBlock(text: string): boolean {
  const trimmed = text.trim();
  const lines = lineSpans(trimmed);
  const marker = lines[0] ? parseOpeningFence(lines[0].text) : undefined;
  return marker !== undefined && lines.length >= 2 && isClosingFenceLine(lines[lines.length - 1].text, marker);
}

function pushTrimmedSpan(out: TokenSpan[], source: string, start: number, end: number, offset = 0): void {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(source[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/u.test(source[trimmedEnd - 1])) trimmedEnd -= 1;
  if (trimmedEnd > trimmedStart) {
    out.push({
      text: source.slice(trimmedStart, trimmedEnd),
      start: offset + trimmedStart,
      end: offset + trimmedEnd,
    });
  }
}

function chunkByChars(text: string, maxChars: number, overlapChars: number): TokenSpan[] {
  const chunks: TokenSpan[] = [];
  const step = Math.max(1, maxChars - overlapChars);
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + maxChars);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push({ text: chunk, start, end });
    if (end >= text.length) break;
  }
  return chunks;
}

function chunkByTokens(text: string, maxTokens: number, overlapTokens: number): TokenSpan[] {
  const tokens = tokenSpans(text);
  if (tokens.length === 0) return [];
  if (tokens.length <= maxTokens)
    return [{ text: text.trim(), start: tokens[0].start, end: tokens[tokens.length - 1].end }];

  const chunks: TokenSpan[] = [];
  const step = Math.max(1, maxTokens - overlapTokens);
  for (let startIndex = 0; startIndex < tokens.length; startIndex += step) {
    const endIndex = Math.min(tokens.length, startIndex + maxTokens);
    const start = tokens[startIndex].start;
    const end = tokens[endIndex - 1].end;
    chunks.push({ text: text.slice(start, end).trim(), start, end });
    if (endIndex >= tokens.length) break;
  }
  return chunks;
}

function tokenSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const regex = /\S+/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    spans.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function countTokens(text: string): number {
  return tokenSpans(text).length;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function readContainedUtf8File(filePath: string, baseRealPath: string): string {
  const beforeStat = lstatSync(filePath);
  if (beforeStat.isSymbolicLink() || !beforeStat.isFile()) {
    throw new Error(`KERN RAG local source file '${filePath}' is not a regular file.`);
  }
  const beforeRealPath = realpathSync(filePath);
  if (!isPathInside(beforeRealPath, baseRealPath)) {
    throw new Error(`KERN RAG local source file '${filePath}' must stay within the declaring .kern file directory.`);
  }

  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStat = fstatSync(fd);
    if (!openedStat.isFile()) {
      throw new Error(`KERN RAG local source file '${filePath}' is not a regular file.`);
    }
    const openedRealPath = realpathSync(filePath);
    if (openedRealPath !== beforeRealPath || !isPathInside(openedRealPath, baseRealPath)) {
      throw new Error(`KERN RAG local source file '${filePath}' changed while it was being ingested.`);
    }
    return readFileSync(fd, 'utf-8');
  } finally {
    closeSync(fd);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function isPathInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
