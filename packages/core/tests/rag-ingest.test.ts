import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from '../src/parser.js';
import {
  ingestRagDeclaredLocalSources,
  RAG_SEMANTIC_CHUNKER_VERSION,
  RAG_TOKEN_WINDOW_CHUNKER_VERSION,
} from '../src/rag-ingest.js';

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
          chunkerVersion: RAG_SEMANTIC_CHUNKER_VERSION,
          chunkingStrategy: 'semantic',
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

  test('semantic strategy preserves markdown heading sections instead of fixed token windows', () => {
    const sectionDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=8 overlap=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-sections-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, sectionDoc);
      writeFileSync(
        join(dir, 'docs/manual.md'),
        '# Refunds\nrefund policy window money back\n\n# Shipping\nshipping courier tracking parcel\n',
      );

      const result = ingestRagDeclaredLocalSources(parseDocument(sectionDoc), { sourcePath });

      expect(result.chunks.map((chunk) => chunk.text)).toEqual([
        '# Refunds\nrefund policy window money back',
        '# Shipping\nshipping courier tracking parcel',
      ]);
      expect(result.chunks.every((chunk) => chunk.metadata?.chunkerVersion === RAG_SEMANTIC_CHUNKER_VERSION)).toBe(
        true,
      );
      expect(result.chunks.every((chunk) => chunk.metadata?.chunkingStrategy === 'semantic')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic strategy keeps fenced code blocks attached to their heading section', () => {
    const codeDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=18 overlap=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-code-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, codeDoc);
      writeFileSync(
        join(dir, 'docs/manual.md'),
        [
          '# Example',
          '',
          '```kern',
          'corpus name=Docs',
          '  source name=manuals uri="./docs/**/*.md"',
          '```',
          '',
          '# Shipping',
          'shipping courier tracking parcel',
          '',
        ].join('\n'),
      );

      const result = ingestRagDeclaredLocalSources(parseDocument(codeDoc), { sourcePath });
      expect(result.chunks[0].text).toContain('```kern\ncorpus name=Docs');
      expect(result.chunks[0].text).toContain('source name=manuals');
      expect(result.chunks[0].text).not.toContain('# Shipping');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic fallback token windows honor overlap for oversized paragraphs', () => {
    const overlapDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=4 overlap=1');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-overlap-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, overlapDoc);
      writeFileSync(join(dir, 'docs/manual.md'), 'one two three four five six seven\n');

      const result = ingestRagDeclaredLocalSources(parseDocument(overlapDoc), { sourcePath });

      expect(result.chunks.map((chunk) => chunk.text)).toEqual(['one two three four', 'four five six seven']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic unit overlap repeats the previous unit when requested overlap is smaller than that unit', () => {
    const overlapDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=6 overlap=2');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-unit-overlap-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, overlapDoc);
      writeFileSync(
        join(dir, 'docs/manual.md'),
        ['intro one two', '', 'middle three four', '', 'final five six', '', 'outro seven eight', ''].join('\n'),
      );

      const result = ingestRagDeclaredLocalSources(parseDocument(overlapDoc), { sourcePath });

      expect(result.chunks.map((chunk) => chunk.text)).toEqual([
        'intro one two\n\nmiddle three four',
        'middle three four\n\nfinal five six',
        'final five six\n\noutro seven eight',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic strategy preserves oversized fenced code blocks instead of splitting fence markers', () => {
    const codeDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=4 overlap=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-large-code-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, codeDoc);
      writeFileSync(
        join(dir, 'docs/manual.md'),
        ['# Example', '', '```kern', 'one two three four five six seven eight', '```', ''].join('\n'),
      );

      const result = ingestRagDeclaredLocalSources(parseDocument(codeDoc), { sourcePath });
      expect(result.chunks.map((chunk) => chunk.text)).toContain(
        '```kern\none two three four five six seven eight\n```',
      );
      expect(result.chunks.some((chunk) => chunk.text.includes('```kern') && !chunk.text.includes('```', 1))).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic fence parsing does not treat closing fences with trailing text as valid boundaries', () => {
    const codeDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=30 overlap=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-invalid-fence-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, codeDoc);
      writeFileSync(
        join(dir, 'docs/manual.md'),
        ['# Example', '', '```kern', 'one two three', '``` trailing', '# NotAHeading', 'inside fence text', ''].join(
          '\n',
        ),
      );

      const result = ingestRagDeclaredLocalSources(parseDocument(codeDoc), { sourcePath });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].text).toContain('# NotAHeading');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic fence parsing requires closing fences to match the opening fence length', () => {
    const codeDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=30 overlap=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-short-fence-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, codeDoc);
      writeFileSync(
        join(dir, 'docs/manual.md'),
        ['# Example', '', '````kern', 'one two three', '```', '# StillInFence', 'inside fence text', '````', ''].join(
          '\n',
        ),
      );

      const result = ingestRagDeclaredLocalSources(parseDocument(codeDoc), { sourcePath });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].text).toContain('# StillInFence');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-semantic chunking keeps the legacy fixed token-window provenance', () => {
    const windowDoc = DOC.replace('strategy=semantic ', 'strategy=window ');
    const { dir, sourcePath } = fixture({ 'docs/refunds.md': 'refund policy window thirty days money back' });
    try {
      const result = ingestRagDeclaredLocalSources(parseDocument(windowDoc), { sourcePath });
      expect(result.chunks[0].metadata).toEqual(
        expect.objectContaining({
          chunkerVersion: RAG_TOKEN_WINDOW_CHUNKER_VERSION,
          chunkingStrategy: 'window',
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails closed when semantic chunking is declared with character units', () => {
    const charSemanticDoc = DOC.replace('unit=tokens', 'unit=chars');
    const { dir, sourcePath } = fixture({ 'docs/refunds.md': 'refund policy window thirty days money back' });
    try {
      expect(() => ingestRagDeclaredLocalSources(parseDocument(charSemanticDoc), { sourcePath })).toThrow(
        /semantic chunking currently requires unit=tokens/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails closed when an unsupported chunking strategy bypasses semantic validation', () => {
    const badStrategyDoc = DOC.replace('strategy=semantic', 'strategy=semnatic');
    const { dir, sourcePath } = fixture({ 'docs/refunds.md': 'refund policy window thirty days money back' });
    try {
      expect(() => ingestRagDeclaredLocalSources(parseDocument(badStrategyDoc), { sourcePath })).toThrow(
        /chunking strategy must be one of/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('semantic strategy satisfies a curated 50-section boundary ground truth', () => {
    const sectionDoc = DOC.replace('maxTokens=5 overlap=1', 'maxTokens=12 overlap=0');
    const dir = mkdtempSync(join(tmpdir(), 'kern-rag-semantic-ground-truth-'));
    const sourcePath = join(dir, 'mydocs.kern');
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(sourcePath, sectionDoc);
      const sections = Array.from({ length: 50 }, (_, index) => {
        const id = String(index).padStart(2, '0');
        return `# Topic ${id}\nneedle-${id} answer-${id} belongs-here-${id}`;
      });
      writeFileSync(join(dir, 'docs/manual.md'), `${sections.join('\n\n')}\n`);

      const result = ingestRagDeclaredLocalSources(parseDocument(sectionDoc), { sourcePath });
      for (let index = 0; index < sections.length; index += 1) {
        const id = String(index).padStart(2, '0');
        const sectionChunks = result.chunks.filter((chunk) => chunk.text.includes(`needle-${id}`));
        expect(sectionChunks).toHaveLength(1);
        expect(sectionChunks[0].text).toBe(`# Topic ${id}\nneedle-${id} answer-${id} belongs-here-${id}`);
      }
      expect(result.chunks.some((chunk) => /^# Topic \d+[\s\S]*# Topic \d+/u.test(chunk.text))).toBe(false);
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
