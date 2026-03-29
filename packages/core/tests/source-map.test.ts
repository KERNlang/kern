import { serializeSourceMap } from '../src/source-map.js';
import type { SourceMapEntry } from '../src/types.js';

describe('Source Map v3 Serializer', () => {
  it('produces valid v3 structure', () => {
    const entries: SourceMapEntry[] = [
      { irLine: 1, irCol: 1, outLine: 1, outCol: 1 },
    ];
    const map = serializeSourceMap(entries, 'Home.tsx', 'Home.kern');

    expect(map.version).toBe(3);
    expect(map.file).toBe('Home.tsx');
    expect(map.sources).toEqual(['Home.kern']);
    expect(map.names).toEqual([]);
    expect(map.sourceRoot).toBe('');
    expect(typeof map.mappings).toBe('string');
  });

  it('encodes single entry correctly', () => {
    const entries: SourceMapEntry[] = [
      { irLine: 1, irCol: 1, outLine: 1, outCol: 1 },
    ];
    const map = serializeSourceMap(entries, 'out.tsx', 'in.kern');
    // All zeros (0-indexed: outCol=0, sourceIdx=0, irLine=0, irCol=0) → AAAA
    expect(map.mappings).toBe('AAAA');
  });

  it('encodes multiple entries on same line', () => {
    const entries: SourceMapEntry[] = [
      { irLine: 1, irCol: 1, outLine: 1, outCol: 1 },
      { irLine: 1, irCol: 5, outLine: 1, outCol: 10 },
    ];
    const map = serializeSourceMap(entries, 'out.tsx', 'in.kern');
    // First: AAAA, second: outCol delta=9, sourceIdx delta=0, irLine delta=0, irCol delta=4
    expect(map.mappings).toContain(',');
    expect(map.mappings.split(',').length).toBe(2);
  });

  it('encodes entries on different lines with semicolons', () => {
    const entries: SourceMapEntry[] = [
      { irLine: 1, irCol: 1, outLine: 1, outCol: 1 },
      { irLine: 2, irCol: 1, outLine: 3, outCol: 1 },
    ];
    const map = serializeSourceMap(entries, 'out.tsx', 'in.kern');
    const parts = map.mappings.split(';');
    // Line 1 has a segment, line 2 is empty, line 3 has a segment
    expect(parts.length).toBe(3);
    expect(parts[0]).not.toBe(''); // line 1
    expect(parts[1]).toBe(''); // line 2 (empty)
    expect(parts[2]).not.toBe(''); // line 3
  });

  it('handles empty entries', () => {
    const map = serializeSourceMap([], 'out.tsx', 'in.kern');
    expect(map.mappings).toBe('');
  });

  it('accepts custom sourceRoot', () => {
    const map = serializeSourceMap([], 'out.tsx', 'in.kern', '/src');
    expect(map.sourceRoot).toBe('/src');
  });

  it('sorts entries by output position', () => {
    // Provide entries out of order
    const entries: SourceMapEntry[] = [
      { irLine: 5, irCol: 1, outLine: 3, outCol: 1 },
      { irLine: 1, irCol: 1, outLine: 1, outCol: 1 },
    ];
    const map = serializeSourceMap(entries, 'out.tsx', 'in.kern');
    // Should not throw and should produce valid semicolon-separated output
    const lines = map.mappings.split(';');
    expect(lines.length).toBe(3); // lines 1, 2 (empty), 3
  });

  it('produces JSON.stringify-able output', () => {
    const entries: SourceMapEntry[] = [
      { irLine: 1, irCol: 1, outLine: 1, outCol: 1 },
      { irLine: 2, irCol: 3, outLine: 2, outCol: 5 },
    ];
    const map = serializeSourceMap(entries, 'out.tsx', 'in.kern');
    const json = JSON.stringify(map);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(3);
    expect(parsed.mappings).toBe(map.mappings);
  });
});
