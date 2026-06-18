import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from '../src/parser.js';
import { ingestRagDeclaredLocalSources } from '../src/rag-ingest.js';

const DOC = `corpus name=Docs
  source name=manuals kind=local uri="./docs/**/*.md" media=markdown
  chunking source=manuals strategy=semantic maxTokens=5 overlap=1 unit=tokens

retriever name=DocsSearch corpus=Docs
rag name=AnswerDocs retriever=DocsSearch
  ragEval name=Faithfulness metric=faithfulness threshold=0.85 mode=contract
    ragCase name=refunds query="refund policy" topK=1
      ragAssert kind=contains value="refund"
`;

function fixture(files: Record<string, string>): { dir: string; sourcePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kern-rag-ingest-'));
  const sourcePath = join(dir, 'mydocs.kern');
  writeFileSync(sourcePath, DOC);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return { dir, sourcePath };
}

describe('RAG declared local source ingestion', () => {
  test('resolves globs relative to the declaring spec and creates stable chunk ids', () => {
    const { dir, sourcePath } = fixture({
      'docs/refunds.md': 'refund policy window thirty days money back',
      'docs/shipping.md': 'shipping delivery courier tracking parcel',
    });
    try {
      const root = parseDocument(DOC);
      const first = ingestRagDeclaredLocalSources(root, { sourcePath });
      const second = ingestRagDeclaredLocalSources(root, { sourcePath });

      expect(first.sources[0].files.map((file) => file.replace(dir, '<dir>'))).toEqual([
        '<dir>/docs/refunds.md',
        '<dir>/docs/shipping.md',
      ]);
      expect(first.chunks.map((chunk) => chunk.id)).toEqual(second.chunks.map((chunk) => chunk.id));
      expect(first.corpusSha256).toBe(second.corpusSha256);
      expect(first.chunks[0].metadata).toEqual(
        expect.objectContaining({
          chunkIdVersion: 'kern-rag-chunk-v1',
          chunkerVersion: 'token-window-v1',
          sourceName: 'manuals',
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('changes chunk ids when source content changes', () => {
    const { dir, sourcePath } = fixture({ 'docs/refunds.md': 'refund policy window thirty days money back' });
    try {
      const root = parseDocument(DOC);
      const before = ingestRagDeclaredLocalSources(root, { sourcePath });
      writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy changed for store credit only');
      const after = ingestRagDeclaredLocalSources(root, { sourcePath });
      expect(before.chunks.map((chunk) => chunk.id)).not.toEqual(after.chunks.map((chunk) => chunk.id));
      expect(before.corpusSha256).not.toBe(after.corpusSha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defensively handles invalid zero maxTokens when called without semantic validation', () => {
    const invalidDoc = DOC.replace('maxTokens=5', 'maxTokens=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-zero-max-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, invalidDoc);
      writeFileSync(join(dir, 'docs/refunds.md'), 'refund policy window');
      const result = ingestRagDeclaredLocalSources(parseDocument(invalidDoc), { sourcePath });
      expect(result.chunks.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('skips symlinked directories while walking source globs', () => {
    const { dir, sourcePath } = fixture({ 'docs/refunds.md': 'refund policy window' });
    try {
      symlinkSync(dir, join(dir, 'docs/loop'), 'dir');
      const result = ingestRagDeclaredLocalSources(parseDocument(DOC), { sourcePath });
      expect(result.chunks.map((chunk) => chunk.source)).toEqual(['docs/refunds.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects source roots that are symlinks outside the spec directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-root-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'kern-rag-outside-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      writeFileSync(sourcePath, DOC);
      writeFileSync(join(outside, 'refunds.md'), 'refund policy window');
      symlinkSync(outside, join(dir, 'docs'), 'dir');
      expect(() => ingestRagDeclaredLocalSources(parseDocument(DOC), { sourcePath })).toThrow(
        /must stay within the declaring \.kern file directory/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('supports bracket character classes in source globs', () => {
    const bracketDoc = DOC.replace('./docs/**/*.md', './docs/[ab].md');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-bracket-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, bracketDoc);
      writeFileSync(join(dir, 'docs/a.md'), 'refund policy');
      writeFileSync(join(dir, 'docs/b.md'), 'shipping policy');
      writeFileSync(join(dir, 'docs/c.md'), 'ignored policy');
      const result = ingestRagDeclaredLocalSources(parseDocument(bracketDoc), { sourcePath });
      expect(result.chunks.map((chunk) => chunk.source)).toEqual(['docs/a.md', 'docs/b.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('orders non-ASCII paths by code point, not host locale collation', () => {
    const sortedDoc = DOC.replace('./docs/**/*.md', './docs/*.md');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-sort-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, sortedDoc);
      writeFileSync(join(dir, 'docs/ä.md'), 'refund policy');
      writeFileSync(join(dir, 'docs/z.md'), 'shipping policy');
      const result = ingestRagDeclaredLocalSources(parseDocument(sortedDoc), { sourcePath });
      expect(result.chunks.map((chunk) => chunk.source)).toEqual(['docs/z.md', 'docs/ä.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects traversal source globs outside the declaring spec directory', () => {
    const traversalDoc = DOC.replace('./docs/**/*.md', '../outside/**/*.md');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-traversal-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      writeFileSync(sourcePath, traversalDoc);
      expect(() => ingestRagDeclaredLocalSources(parseDocument(traversalDoc), { sourcePath })).toThrow(
        /absolute paths and '\.\.' segments are not allowed/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects absolute source globs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-absolute-'));
    const absoluteDoc = DOC.replace('./docs/**/*.md', join(dir, 'docs', '**', '*.md'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      writeFileSync(sourcePath, absoluteDoc);
      expect(() => ingestRagDeclaredLocalSources(parseDocument(absoluteDoc), { sourcePath })).toThrow(
        /absolute paths and '\.\.' segments are not allowed/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
