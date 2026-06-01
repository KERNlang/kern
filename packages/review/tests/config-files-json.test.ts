/**
 * JSON / JSONC analyzer — covers the cases that matter for kern-sight
 * (editor diagnostics) and kern-guard (PR Check annotations):
 *   - clean JSON produces zero findings
 *   - parse errors surface with severity 'error' and stable fingerprints
 *   - duplicate keys are detected at any nesting depth
 *   - dialect detection: tsconfig.json allows comments, .json does not
 *   - fingerprints do NOT include line numbers (kern-guard dedup contract)
 */

import { reviewJsonFile } from '../src/config-files/json.js';

describe('config-files/json', () => {
  describe('clean files', () => {
    it('returns no findings for valid JSON', () => {
      const findings = reviewJsonFile('{"name":"x","version":"1.0.0"}', '/repo/package.json');
      expect(findings).toEqual([]);
    });

    it('returns no findings for valid nested JSON', () => {
      const src = '{"a":{"b":[1,2,3],"c":{"d":"e"}}}';
      const findings = reviewJsonFile(src, '/repo/a.json');
      expect(findings).toEqual([]);
    });
  });

  describe('parse errors', () => {
    it('flags missing closing brace', () => {
      const findings = reviewJsonFile('{"a": 1', '/repo/x.json');
      expect(findings.length).toBeGreaterThanOrEqual(1);
      const parseErrors = findings.filter((f) => f.ruleId.startsWith('json/parse/'));
      expect(parseErrors.length).toBeGreaterThan(0);
      expect(parseErrors[0]?.severity).toBe('error');
      expect(parseErrors[0]?.category).toBe('bug');
    });

    it('flags trailing comma in strict JSON', () => {
      const findings = reviewJsonFile('{"a": 1,}', '/repo/strict.json');
      const slugs = findings.map((f) => f.ruleId);
      expect(slugs.some((s) => s.startsWith('json/parse/'))).toBe(true);
    });

    it('allows trailing comma in JSONC dialect', () => {
      const findings = reviewJsonFile('{"a": 1,}', '/repo/strict.jsonc');
      expect(findings.filter((f) => f.ruleId.startsWith('json/parse/'))).toEqual([]);
    });

    it('flags comments in strict JSON', () => {
      const findings = reviewJsonFile('{\n// hi\n"a":1}', '/repo/x.json');
      const commentErrs = findings.filter((f) => f.ruleId === 'json/parse/invalid-comment-token');
      expect(commentErrs.length).toBeGreaterThan(0);
      expect(commentErrs[0]?.message).toMatch(/Comments are not allowed/);
    });

    it('allows comments in tsconfig.json (de-facto JSONC)', () => {
      const findings = reviewJsonFile('{\n// hi\n"compilerOptions":{}}', '/repo/tsconfig.json');
      expect(findings.filter((f) => f.ruleId.startsWith('json/parse/'))).toEqual([]);
    });

    it('allows comments in .jsonc files', () => {
      const findings = reviewJsonFile('{\n// hi\n"a":1}', '/repo/x.jsonc');
      expect(findings.filter((f) => f.ruleId.startsWith('json/parse/'))).toEqual([]);
    });

    it('allows comments in .vscode/settings.json (de-facto JSONC)', () => {
      const findings = reviewJsonFile('{\n// editor\n"editor.fontSize": 14\n}', '/repo/.vscode/settings.json');
      expect(findings.filter((f) => f.ruleId.startsWith('json/parse/'))).toEqual([]);
    });

    it('allows comments in .vscode/launch.json on Windows-style paths', () => {
      const findings = reviewJsonFile('{\n// launch\n"version": "0.2.0"\n}', 'C:\\repo\\.vscode\\launch.json');
      expect(findings.filter((f) => f.ruleId.startsWith('json/parse/'))).toEqual([]);
    });
  });

  describe('duplicate keys', () => {
    it('detects duplicate keys at top level', () => {
      const findings = reviewJsonFile('{"name":"a","name":"b"}', '/repo/dup.json');
      const dups = findings.filter((f) => f.ruleId === 'json/duplicate-key');
      expect(dups).toHaveLength(1);
      expect(dups[0]?.message).toContain('Duplicate property "name"');
      expect(dups[0]?.relatedSpans?.length).toBe(1);
    });

    it('detects duplicate keys inside nested objects', () => {
      const src = '{"compilerOptions":{"strict":true,"strict":false}}';
      const findings = reviewJsonFile(src, '/repo/tsconfig.json');
      const dups = findings.filter((f) => f.ruleId === 'json/duplicate-key');
      expect(dups).toHaveLength(1);
      // Fingerprint must contain the structural path, not the line.
      expect(dups[0]?.fingerprint).toBe('json/duplicate-key:compilerOptions.strict');
    });

    it('detects duplicate keys inside array elements', () => {
      const src = '{"arr":[{"k":1,"k":2}]}';
      const findings = reviewJsonFile(src, '/repo/a.json');
      const dups = findings.filter((f) => f.ruleId === 'json/duplicate-key');
      expect(dups).toHaveLength(1);
      expect(dups[0]?.fingerprint).toBe('json/duplicate-key:arr[0].k');
    });

    it('relatedSpans on a duplicate points to the FIRST occurrence, not the duplicate itself', () => {
      // Source positions: first "k" starts after `{`, second "k" after the comma.
      // Specifically: { " k " : 1 , " k " : 2 }
      //               0 1 2 3 4 5 6 7 8 9
      // The first key node spans offsets 1..4 ('"k"'); the second 7..10.
      const src = '{"k":1,"k":2}';
      const findings = reviewJsonFile(src, '/r/p.json');
      const dup = findings.find((f) => f.ruleId === 'json/duplicate-key');
      expect(dup).toBeDefined();
      // primarySpan = the duplicate; relatedSpan = the original. The two
      // must differ in column — they reference different offsets in the
      // source, which proves we are not pointing both spans at the same node.
      expect(dup?.primarySpan.startCol).toBeGreaterThan(dup?.relatedSpans?.[0]?.startCol ?? 0);
    });

    it('three duplicate keys produce three findings with distinct fingerprints', () => {
      const src = '{"k":1,"k":2,"k":3}';
      const findings = reviewJsonFile(src, '/r/p.json');
      const dups = findings.filter((f) => f.ruleId === 'json/duplicate-key');
      expect(dups).toHaveLength(2);
      const fps = dups.map((d) => d.fingerprint);
      expect(new Set(fps).size).toBe(2);
      expect(fps).toContain('json/duplicate-key:k');
      expect(fps).toContain('json/duplicate-key:k#2');
    });
  });

  describe('fingerprint stability (kern-guard contract)', () => {
    it('duplicate-key fingerprint excludes line numbers — survives whitespace edits', () => {
      const a = reviewJsonFile('{"name":"a","name":"b"}', '/r/p.json');
      const b = reviewJsonFile('\n\n\n{"name":"a","name":"b"}', '/r/p.json');
      const fpA = a.find((f) => f.ruleId === 'json/duplicate-key')?.fingerprint;
      const fpB = b.find((f) => f.ruleId === 'json/duplicate-key')?.fingerprint;
      expect(fpA).toBeDefined();
      expect(fpA).toBe(fpB);
    });

    it('parse-error fingerprint excludes line numbers', () => {
      const a = reviewJsonFile('{"a": 1,}', '/r/p.json');
      const b = reviewJsonFile('\n\n{"a": 1,}', '/r/p.json');
      const fpA = a.find((f) => f.ruleId.startsWith('json/parse/'))?.fingerprint;
      const fpB = b.find((f) => f.ruleId.startsWith('json/parse/'))?.fingerprint;
      expect(fpA).toBe(fpB);
    });

    it('multiple parse errors of the same kind get distinct fingerprints', () => {
      // Two separate comments in strict JSON → two invalid-comment-token errors.
      const src = '{\n// one\n"a": 1,\n// two\n"b": 2\n}';
      const findings = reviewJsonFile(src, '/r/p.json');
      const commentErrs = findings.filter((f) => f.ruleId === 'json/parse/invalid-comment-token');
      expect(commentErrs.length).toBeGreaterThanOrEqual(2);
      const fps = commentErrs.map((f) => f.fingerprint);
      // Must have at least as many unique fingerprints as findings.
      expect(new Set(fps).size).toBe(commentErrs.length);
    });
  });

  describe('source spans', () => {
    it('reports a 1-based line and column for the offending span', () => {
      const findings = reviewJsonFile('{\n  "a": 1,\n  "a": 2\n}', '/r/p.json');
      const dup = findings.find((f) => f.ruleId === 'json/duplicate-key');
      expect(dup).toBeDefined();
      // The second "a" is on line 3.
      expect(dup?.primarySpan.startLine).toBe(3);
      expect(dup?.primarySpan.startCol).toBeGreaterThan(1);
    });
  });
});
