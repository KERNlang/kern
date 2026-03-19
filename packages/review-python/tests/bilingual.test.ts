/**
 * Bilingual Tests — same concept rule, two languages, same findings.
 *
 * This is the proof that KERN concepts are universal.
 */

import { extractPythonConcepts } from '../src/mapper.js';
import { extractTsConcepts, runConceptRules } from '@kernlang/review';
import { Project } from 'ts-morph';

function tsSourceFile(source: string, filePath = 'test.ts') {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return project.createSourceFile(filePath, source);
}

describe('Bilingual: ignored-error', () => {
  it('TS empty catch → ignored-error finding', () => {
    const sf = tsSourceFile('try { doWork(); } catch (e) {}');
    const concepts = extractTsConcepts(sf, 'test.ts');
    const findings = runConceptRules(concepts, 'test.ts');
    const f = findings.find(f => f.ruleId === 'ignored-error');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('Python except:pass → same ignored-error finding', () => {
    const source = `
try:
    do_work()
except:
    pass
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    const findings = runConceptRules(concepts, 'test.py');
    const f = findings.find(f => f.ruleId === 'ignored-error');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('Python except Exception as e: ... → same ignored-error finding', () => {
    const source = `
try:
    do_work()
except Exception as e:
    ...
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    const findings = runConceptRules(concepts, 'test.py');
    const f = findings.find(f => f.ruleId === 'ignored-error');
    expect(f).toBeDefined();
  });

  it('TS catch with handler → NO finding', () => {
    const sf = tsSourceFile('try { doWork(); } catch (e) { throw new AppError(e); }');
    const concepts = extractTsConcepts(sf, 'test.ts');
    const findings = runConceptRules(concepts, 'test.ts');
    const f = findings.find(f => f.ruleId === 'ignored-error');
    expect(f).toBeUndefined();
  });

  it('Python except with raise → NO finding', () => {
    const source = `
try:
    do_work()
except Exception as e:
    raise AppError(e)
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    const findings = runConceptRules(concepts, 'test.py');
    const f = findings.find(f => f.ruleId === 'ignored-error');
    expect(f).toBeUndefined();
  });
});

describe('Bilingual: concept parity', () => {
  it('TS throw and Python raise produce same concept shape', () => {
    const tsSf = tsSourceFile('function fail() { throw new Error("boom"); }');
    const tsConcepts = extractTsConcepts(tsSf, 'test.ts');

    const pyConcepts = extractPythonConcepts('def fail():\n    raise ValueError("boom")', 'test.py');

    const tsRaise = tsConcepts.nodes.find(n => n.kind === 'error_raise');
    const pyRaise = pyConcepts.nodes.find(n => n.kind === 'error_raise');

    expect(tsRaise).toBeDefined();
    expect(pyRaise).toBeDefined();
    expect(tsRaise!.kind).toBe(pyRaise!.kind);
    expect(tsRaise!.payload.kind).toBe(pyRaise!.payload.kind);
    if (tsRaise!.payload.kind === 'error_raise' && pyRaise!.payload.kind === 'error_raise') {
      expect(tsRaise!.payload.subtype).toBe('throw');
      expect(pyRaise!.payload.subtype).toBe('throw');
    }
  });

  it('TS fetch and Python requests.get produce same effect concept', () => {
    const tsSf = tsSourceFile('async function getData() { await fetch("/api"); }');
    const tsConcepts = extractTsConcepts(tsSf, 'test.ts');

    const pyConcepts = extractPythonConcepts('def get_data():\n    requests.get("/api")', 'test.py');

    const tsEffect = tsConcepts.nodes.find(n => n.kind === 'effect');
    const pyEffect = pyConcepts.nodes.find(n => n.kind === 'effect');

    expect(tsEffect).toBeDefined();
    expect(pyEffect).toBeDefined();
    expect(tsEffect!.kind).toBe(pyEffect!.kind);
    if (tsEffect!.payload.kind === 'effect' && pyEffect!.payload.kind === 'effect') {
      expect(tsEffect!.payload.subtype).toBe('network');
      expect(pyEffect!.payload.subtype).toBe('network');
    }
  });
});
