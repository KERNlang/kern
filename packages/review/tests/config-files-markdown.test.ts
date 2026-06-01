/**
 * Markdown analyzer + outline extractor.
 *
 * Covers what kern-sight (editor) and kern-guard (PR Check) actually rely on:
 *   - clean markdown → no findings, but a populated outline
 *   - skipped heading levels detected (h1 → h3)
 *   - missing alt text on images flagged
 *   - fingerprints are path-stable (no line numbers — kern-guard dedup)
 *   - outline tree nests correctly under deeper headings
 */

import { extractMarkdownOutline, reviewMarkdownFile } from '../src/config-files/markdown.js';

describe('config-files/markdown', () => {
  describe('clean markdown', () => {
    it('returns no findings for a well-structured doc', () => {
      const src = '# Title\n\n## Section\n\nProse.\n\n### Subsection\n\nMore prose.\n';
      expect(reviewMarkdownFile(src, '/r/doc.md')).toEqual([]);
    });

    it('does not flag well-structured doc with an image that has alt text', () => {
      const src = '# T\n\n![A descriptive cat](cat.png)\n';
      expect(reviewMarkdownFile(src, '/r/x.md')).toEqual([]);
    });
  });

  describe('skipped heading levels', () => {
    it('flags h1 → h3 jump', () => {
      const src = '# Title\n\n### Sub\n';
      const findings = reviewMarkdownFile(src, '/r/x.md');
      const skipped = findings.filter((f) => f.ruleId === 'md/skipped-heading-level');
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.severity).toBe('warning');
      expect(skipped[0]?.message).toMatch(/h1 to h3/);
    });

    it('does not flag h3 → h2 (going shallower is fine)', () => {
      const src = '# T\n\n## A\n\n### B\n\n## C\n';
      const findings = reviewMarkdownFile(src, '/r/x.md');
      expect(findings.filter((f) => f.ruleId === 'md/skipped-heading-level')).toEqual([]);
    });

    it('flags h2 → h5', () => {
      const src = '# T\n\n## A\n\n##### Deep\n';
      const findings = reviewMarkdownFile(src, '/r/x.md');
      expect(findings.filter((f) => f.ruleId === 'md/skipped-heading-level')).toHaveLength(1);
    });
  });

  describe('image missing alt', () => {
    it('flags ![](x.png)', () => {
      const findings = reviewMarkdownFile('# T\n\n![](x.png)\n', '/r/x.md');
      const missing = findings.filter((f) => f.ruleId === 'md/image-missing-alt');
      expect(missing).toHaveLength(1);
      expect(missing[0]?.fingerprint).toBe('md/image-missing-alt:x.png');
    });

    it('does not flag images with non-empty alt', () => {
      const findings = reviewMarkdownFile('![A cat](x.png)\n', '/r/x.md');
      expect(findings.filter((f) => f.ruleId === 'md/image-missing-alt')).toEqual([]);
    });
  });

  describe('fingerprint stability (kern-guard contract)', () => {
    it('skipped-heading fingerprint excludes line numbers', () => {
      const a = reviewMarkdownFile('# T\n\n### Sub\n', '/r/x.md');
      const b = reviewMarkdownFile('\n\n\n# T\n\n### Sub\n', '/r/x.md');
      const fpA = a.find((f) => f.ruleId === 'md/skipped-heading-level')?.fingerprint;
      const fpB = b.find((f) => f.ruleId === 'md/skipped-heading-level')?.fingerprint;
      expect(fpA).toBeDefined();
      expect(fpA).toBe(fpB);
    });

    it('image-missing-alt fingerprint uses URL, not line', () => {
      const a = reviewMarkdownFile('![](logo.png)\n', '/r/x.md');
      const b = reviewMarkdownFile('\n\n\n![](logo.png)\n', '/r/x.md');
      const fpA = a.find((f) => f.ruleId === 'md/image-missing-alt')?.fingerprint;
      const fpB = b.find((f) => f.ruleId === 'md/image-missing-alt')?.fingerprint;
      expect(fpA).toBe(fpB);
    });
  });

  describe('outline extraction', () => {
    it('returns a flat list of headings in source order', () => {
      const src = '# A\n\n## B\n\n## C\n\n### D\n';
      const { flat } = extractMarkdownOutline(src);
      expect(flat.map((h) => `${h.level}:${h.text}`)).toEqual(['1:A', '2:B', '2:C', '3:D']);
    });

    it('builds a tree where deeper headings nest under shallower siblings', () => {
      const src = '# A\n\n## B\n\n### C\n\n## D\n';
      const { tree } = extractMarkdownOutline(src);
      expect(tree).toHaveLength(1);
      expect(tree[0]?.text).toBe('A');
      expect(tree[0]?.children).toHaveLength(2);
      expect(tree[0]?.children[0]?.text).toBe('B');
      expect(tree[0]?.children[0]?.children[0]?.text).toBe('C');
      expect(tree[0]?.children[1]?.text).toBe('D');
    });

    it('slugifies headings GitHub-style', () => {
      const { flat } = extractMarkdownOutline('# Hello World!\n\n## API & Usage\n');
      expect(flat[0]?.slug).toBe('hello-world');
      expect(flat[1]?.slug).toBe('api--usage');
    });

    it('preserves underscores and other meaningful chars in heading text (codex regression)', () => {
      // Pre-fix bug: heading text had /[`*_]/g globally stripped, so
      // `## API_KEY` became `APIKEY` in the outline and in fingerprints,
      // regressing vs the prior mdast implementation.
      const { flat } = extractMarkdownOutline('# Title\n\n## API_KEY rotation\n');
      expect(flat[1]?.text).toBe('API_KEY rotation');
      expect(flat[1]?.slug).toBe('api_key-rotation');
    });

    it('preserves non-Latin characters in slugs (Unicode-aware)', () => {
      const { flat } = extractMarkdownOutline('# Café\n\n## 中文 Section\n\n## Привет\n');
      expect(flat[0]?.slug).toBe('café');
      expect(flat[1]?.slug).toBe('中文-section');
      expect(flat[2]?.slug).toBe('привет');
    });
  });

  describe('fenced code awareness (self-contained scanner)', () => {
    // The self-contained scanner replaced mdast-util-from-markdown. mdast
    // would never see content inside fences as headings/images because of
    // CommonMark precedence; our scanner needs an explicit fence state
    // machine to match that. These tests lock the contract in.

    it('ignores ATX headings inside backtick fences', () => {
      const src = '# Real\n\n```\n# Inside fence — not a heading\n## Also not\n```\n\n## Real h2\n';
      const findings = reviewMarkdownFile(src, '/r/x.md');
      // h1 (Real) then h2 (Real h2) — no skip, no flags. If the scanner
      // were treating the in-fence # as a heading at depth 1, the next
      // real h2 would be normal too — but if it counted "## Also not" as
      // h2, then "Real h2" wouldn't skip either. So this test mostly
      // proves the outline doesn't include the fenced content.
      expect(findings.filter((f) => f.ruleId === 'md/skipped-heading-level')).toEqual([]);
      const { flat } = extractMarkdownOutline(src);
      expect(flat.map((h) => h.text)).toEqual(['Real', 'Real h2']);
    });

    it('ignores image syntax inside fences', () => {
      const src = '# T\n\n```\n![](broken.png)\n```\n\n![ok](good.png)\n';
      const findings = reviewMarkdownFile(src, '/r/x.md');
      // The in-fence `![](broken.png)` must NOT fire md/image-missing-alt.
      // The out-of-fence `![ok](good.png)` has alt text, so no finding.
      expect(findings.filter((f) => f.ruleId === 'md/image-missing-alt')).toEqual([]);
    });

    it('handles tilde fences identically to backtick fences', () => {
      const src = '# T\n\n~~~\n# In tilde fence\n~~~\n\n## After\n';
      const { flat } = extractMarkdownOutline(src);
      expect(flat.map((h) => h.text)).toEqual(['T', 'After']);
    });

    it('matches close fence by character + length', () => {
      // Open with ````, close needs at least 4 backticks. The ``` inside
      // does NOT close it, so the # below the inner ``` is still in-fence.
      const src = '# T\n\n````\n```\n# Still in fence\n```\n````\n\n## Real\n';
      const { flat } = extractMarkdownOutline(src);
      expect(flat.map((h) => h.text)).toEqual(['T', 'Real']);
    });

    it('does NOT close a fence when the marker has trailing non-whitespace (codex+kimi regression)', () => {
      // Pre-fix bug: any line starting with the matching fence run closed
      // the fence, even if followed by text. Per CommonMark §4.5, a
      // closing fence may have ONLY whitespace after the marker — ```text
      // does not close, it stays in-fence content.
      const src = '# T\n\n```\n```text\n# Still in fence\n```\n\n## Real\n';
      const findings = reviewMarkdownFile(src, '/r/x.md');
      const { flat } = extractMarkdownOutline(src);
      expect(flat.map((h) => h.text)).toEqual(['T', 'Real']);
      expect(findings.filter((f) => f.ruleId === 'md/skipped-heading-level')).toEqual([]);
    });

    it('does NOT treat a 4-space-indented ``` as a fence (codex regression)', () => {
      // Pre-fix bug: arbitrary leading whitespace was stripped before
      // fence detection, so a 4-space-indented ``` was treated as a real
      // fence. Per CommonMark, a fence opener allows ≤3 spaces of indent.
      const src = '# Top\n\n    ```\n    not really a fence\n    ```\n\n## Real\n';
      const { flat } = extractMarkdownOutline(src);
      expect(flat.map((h) => h.text)).toEqual(['Top', 'Real']);
    });
  });

  describe('heading path stack stability (Gemini blocking fix)', () => {
    // Pre-fix bug: the running stack used `length >= depth` to decide when
    // to pop, but length and depth aren't the same thing when levels are
    // skipped. After `# A`, `### B`, `### C` the stack ended up
    // ['a','b','c'] instead of ['a','c'], so a *later* skipped-level
    // heading's fingerprint depended on B's text. Renaming B (an upstream
    // sibling that should be irrelevant) would shift the later finding's
    // fingerprint, and kern-guard would re-post it as "new" on the next PR.
    //
    // This test demonstrates the cross-sibling fingerprint coupling by
    // renaming B and asserting F's skipped-heading fingerprint is unchanged.
    it('renaming an upstream sibling does not shift a downstream skipped-heading fingerprint', () => {
      const before = reviewMarkdownFile('# Top\n\n### Beta\n\n### Charlie\n\n###### Foxtrot\n', '/r/x.md');
      const after = reviewMarkdownFile('# Top\n\n### BetaRenamed\n\n### Charlie\n\n###### Foxtrot\n', '/r/x.md');
      // Foxtrot (h6 directly under h3) is the skipped-level heading. Find
      // it by its primarySpan line (last line that contains a heading) in
      // both runs.
      const fpBefore = before.find(
        (f) => f.ruleId === 'md/skipped-heading-level' && f.message.includes('h3 to h6'),
      )?.fingerprint;
      const fpAfter = after.find(
        (f) => f.ruleId === 'md/skipped-heading-level' && f.message.includes('h3 to h6'),
      )?.fingerprint;
      expect(fpBefore).toBeDefined();
      expect(fpAfter).toBeDefined();
      expect(fpBefore).toBe(fpAfter);
      // And the actual path should reflect only ancestors (Top → Charlie → Foxtrot),
      // NOT include Beta — the proof that the stack is correctly popping siblings.
      expect(fpBefore).toBe('md/skipped-heading-level:top/charlie/foxtrot');
    });
  });
});
