import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

describe('LLM-Speach IR Fitness Tests', () => {
  // ── Spec Tests ──────────────────────────────────────────────────────────
  describe('IR Spec', () => {
    test('spec file exists at src/spec.ts or src/spec.json', () => {
      const tsExists = existsSync(resolve(ROOT, 'src/spec.ts'));
      const jsonExists = existsSync(resolve(ROOT, 'src/spec.json'));
      expect(tsExists || jsonExists).toBe(true);
    });

    test('types.ts exports LLMSpeachEngine interface', () => {
      const types = readFileSync(resolve(ROOT, 'src/types.ts'), 'utf-8');
      expect(types).toContain('export interface LLMSpeachEngine');
      expect(types).toContain('parse(');
      expect(types).toContain('transpile(');
      expect(types).toContain('decompile(');
    });
  });

  // ── Parser Tests ────────────────────────────────────────────────────────
  describe('Parser', () => {
    test('parser module exists', () => {
      const exists = existsSync(resolve(ROOT, 'src/parser.ts'));
      expect(exists).toBe(true);
    });

    test('parser can parse the dashboard example', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const parse = parserMod.parse || parserMod.default?.parse;
      expect(parse).toBeDefined();

      // Read the dashboard IR example
      const irPath = resolve(ROOT, 'examples/dashboard.ir');
      expect(existsSync(irPath)).toBe(true);

      const irSource = readFileSync(irPath, 'utf-8');
      const ast = parse(irSource);

      expect(ast).toBeDefined();
      expect(ast.type).toBeDefined();
      expect(typeof ast.type).toBe('string');
    });

    test('parser produces nodes with source locations', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const parse = parserMod.parse || parserMod.default?.parse;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);

      // At least the root node should have location info
      expect(ast.loc).toBeDefined();
      expect(ast.loc?.line).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Transpiler Tests ──────────────────────────────────────────────────
  describe('Transpiler', () => {
    test('transpiler module exists', () => {
      const exists = existsSync(resolve(ROOT, 'src/transpiler.ts'));
      expect(exists).toBe(true);
    });

    test('transpiler produces valid React Native TypeScript', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      expect(transpile).toBeDefined();

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      // Must produce code
      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(100);

      // Must contain React Native imports
      expect(result.code).toContain('react-native');
      expect(result.code).toContain('View');
      expect(result.code).toContain('Text');

      // Must contain the dashboard components
      expect(result.code).toContain('FITVT');
    });

    test('transpiler produces source map entries', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      expect(result.sourceMap).toBeDefined();
      expect(Array.isArray(result.sourceMap)).toBe(true);
      expect(result.sourceMap.length).toBeGreaterThan(0);
    });

    test('transpiler reports token counts', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      expect(result.irTokenCount).toBeGreaterThan(0);
      expect(result.tsTokenCount).toBeGreaterThan(0);
      expect(result.tokenReduction).toBeGreaterThan(0);
    });
  });

  // ── Token Efficiency Tests ────────────────────────────────────────────
  describe('Token Efficiency', () => {
    test('IR achieves at least 30% token reduction vs TypeScript output', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      // At least 30% reduction (conservative — target is 40-65%)
      expect(result.tokenReduction).toBeGreaterThanOrEqual(30);
    });
  });

  // ── Decompiler Tests ──────────────────────────────────────────────────
  describe('Decompiler', () => {
    test('decompiler module exists', () => {
      const exists = existsSync(resolve(ROOT, 'src/decompiler.ts'));
      expect(exists).toBe(true);
    });

    test('decompiler produces human-readable output', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const decompilerMod = await import(resolve(ROOT, 'src/decompiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const decompile = decompilerMod.decompile || decompilerMod.default?.decompile;

      expect(decompile).toBeDefined();

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = decompile(ast);

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(50);
      // Should be readable TypeScript-like output
      expect(result.code).toContain('Dashboard');
    });
  });
});
