import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectKirPreviewModules, parseKirAnalysisMode } from '../src/commands/review-kir-preview.js';

describe('KIR preview CLI helpers', () => {
  it('leaves the legacy path unselected unless the analysis flag is explicit', () => {
    expect(parseKirAnalysisMode(['example.kern', '--json'])).toBeUndefined();
    expect(parseKirAnalysisMode(['example.kern', '--analysis-mode=legacy-source'])).toBe('legacy-source');
    expect(parseKirAnalysisMode(['example.kern', '--analysis-mode', 'dual-compare'])).toBe('dual-compare');
  });

  it('rejects missing and unknown analysis modes', () => {
    expect(() => parseKirAnalysisMode(['--analysis-mode'])).toThrow(/invalid/u);
    expect(() => parseKirAnalysisMode(['--analysis-mode=source'])).toThrow(/legacy-source/u);
  });

  it('reads only KERN sources and gives them stable slash-separated identities', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kern-cli-kir-preview-'));
    try {
      const file = join(directory, 'fixture.kern');
      writeFileSync(file, 'fn name=fixture export=true\n', 'utf8');
      expect(collectKirPreviewModules([file], directory)).toEqual([
        { moduleId: 'fixture.kern', source: 'fn name=fixture export=true\n' },
      ]);
      expect(collectKirPreviewModules([file], join(tmpdir(), 'unrelated-cwd'))).toEqual([
        { moduleId: 'fixture.kern', source: 'fn name=fixture export=true\n' },
      ]);
      expect(() => collectKirPreviewModules([join(directory, 'fixture.ts')], directory)).toThrow(/only .kern/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
