import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as ts from 'typescript';
import { parse } from '../../core/src/parser.js';
import { runCompile } from '../src/commands/compile.js';
import { runImport } from '../src/commands/import.js';
import { checkVersionDrift, loadConfig } from '../src/shared.js';

describe('kern import/compile commands', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];
  let errors: string[];
  let warnings: string[];
  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWarn: typeof console.warn;
  let origExit: typeof process.exit;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-cli-import-compile-'));
    logs = [];
    errors = [];
    warnings = [];
    origLog = console.log;
    origError = console.error;
    origWarn = console.warn;
    origExit = process.exit;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exit = origExit;
    process.chdir(cwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function trapExit(): () => number | undefined {
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`EXIT:${code ?? 0}`);
    }) as never;
    return () => exitCode;
  }

  function transpileTsModule(filePath: string): string {
    const source = readFileSync(filePath, 'utf-8');
    const outputPath = filePath.replace(/\.tsx?$/, '.js');
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filePath,
    });
    writeFileSync(outputPath, result.outputText);
    return outputPath;
  }

  function writeRuntimeStub(rootDir: string, modulePath: string, packageJson: string, indexSource: string): void {
    const packageDir = join(rootDir, 'node_modules', modulePath);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), packageJson);
    writeFileSync(join(packageDir, 'index.js'), indexSource);
  }

  function installInkRuntimeStubs(rootDir: string): void {
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

    writeRuntimeStub(
      rootDir,
      'react',
      JSON.stringify(
        {
          name: 'react',
          type: 'module',
          exports: {
            '.': './index.js',
            './jsx-runtime': './jsx-runtime.js',
          },
        },
        null,
        2,
      ),
      [
        'export function useState(initial) {',
        "  const value = typeof initial === 'function' ? initial() : initial;",
        '  return [value, () => {}];',
        '}',
        'export function useMemo(factory) { return factory(); }',
        'export function useCallback(fn) { return fn; }',
        'export function useEffect(fn) { fn(); }',
        'export function useRef(initial) { return { current: initial }; }',
        'export function useReducer(_reducer, initial) { return [initial, () => {}]; }',
        'export function memo(component) { return component; }',
        'const React = { memo };',
        'export default React;',
      ].join('\n'),
    );
    writeFileSync(
      join(rootDir, 'node_modules', 'react', 'jsx-runtime.js'),
      [
        'export const Fragment = Symbol.for("react.fragment");',
        'export function jsx(type, props) { return { type, props: props ?? {} }; }',
        'export const jsxs = jsx;',
      ].join('\n'),
    );

    writeRuntimeStub(
      rootDir,
      'ink',
      JSON.stringify({ name: 'ink', type: 'module', exports: './index.js' }, null, 2),
      [
        'function flatten(node) {',
        "  if (node == null || node === false || node === true) return '';",
        "  if (Array.isArray(node)) return node.map(flatten).join('');",
        "  if (typeof node === 'string' || typeof node === 'number') return String(node);",
        "  if (typeof node.type === 'function') return flatten(node.type(node.props ?? {}));",
        "  return flatten(node.props?.children ?? '');",
        '}',
        'export function Box(props) { return props.children ?? null; }',
        'export function Text(props) { return props.children ?? null; }',
        'export function Static(props) { return props.children ?? null; }',
        'export function Newline() { return "\\n"; }',
        'export function useApp() { return { exit() {} }; }',
        'export function useFocus() { return { isFocused: false }; }',
        'export function useInput() {}',
        'export function render(element) {',
        '  console.log(JSON.stringify({ event: "render", output: flatten(element) }));',
        '  return { waitUntilExit: async () => console.log(JSON.stringify({ event: "waitUntilExit" })) };',
        '}',
      ].join('\n'),
    );

    writeRuntimeStub(
      rootDir,
      '@inkjs/ui',
      JSON.stringify({ name: '@inkjs/ui', type: 'module', exports: './index.js' }, null, 2),
      [
        'export function Spinner() { return "Spinner"; }',
        'export function TextInput(props) { return props.placeholder ?? ""; }',
        'export function Select() { return "Select"; }',
        'export function MultiSelect() { return "MultiSelect"; }',
        'export function ConfirmInput() { return "ConfirmInput"; }',
        'export function PasswordInput() { return "PasswordInput"; }',
        'export function StatusMessage(props) { return props.children ?? ""; }',
        'export function Alert(props) { return props.children ?? ""; }',
        'export function OrderedList(props) { return props.children ?? ""; }',
        'export function UnorderedList(props) { return props.children ?? ""; }',
      ].join('\n'),
    );
  }

  it('round-trips TypeScript through kern import and kern compile', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'load-user.ts');
    writeFileSync(
      sourceFile,
      `
export async function loadUser(id: string): Promise<User> {
  const response = await fetch('/api/users/' + id);
  return response.json();
}
`,
    );

    const kernOutDir = join(tmpDir, 'kern-out');
    runImport(['import', sourceFile, `--outdir=${kernOutDir}`]);

    const kernFile = join(kernOutDir, 'load-user.kern');
    expect(existsSync(kernFile)).toBe(true);
    const kernSource = readFileSync(kernFile, 'utf-8');
    expect(kernSource).toContain('fn name=loadUser');
    expect(() => parse(kernSource)).not.toThrow();

    const generatedDir = join(tmpDir, 'generated');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', kernFile, `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');
    expect(getExitCode()).toBe(0);

    const compiledFile = join(generatedDir, 'load-user.ts');
    expect(existsSync(compiledFile)).toBe(true);
    const compiled = readFileSync(compiledFile, 'utf-8');
    expect(compiled).toContain('@kern-source: load-user:1');
    expect(compiled).toContain('loadUser');
    expect(compiled).toContain('return response.json();');
    expect(logs.join('\n')).toContain('Compiled 1/1 files');
    expect(errors).toEqual([]);
  });

  it('checks TypeScript imports without writing KERN output', () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'add.ts');
    writeFileSync(sourceFile, 'export function add(a: number, b: number): number { return a + b; }\n');

    runImport(['import', sourceFile, '--check']);

    expect(existsSync(join(tmpDir, 'add.kern'))).toBe(false);
    expect(logs.join('\n')).toContain('Import check passed');
    expect(errors).toEqual([]);
  });

  it('emits JSON import check reports', () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'bag.ts');
    writeFileSync(sourceFile, 'export interface Bag { [key: string]: number; }\n');

    runImport(['import', sourceFile, '--json']);

    const report = JSON.parse(logs.join('\n'));
    expect(report.ok).toBe(true);
    expect(report.files).toHaveLength(1);
    expect(report.files[0].unmapped).toEqual([]);
    expect(report.files[0].diagnostics).toEqual([]);
    expect(report.files[0].schemaViolations).toEqual([]);
    expect(report.files[0].semanticViolations).toEqual([]);
    expect(report.files[0].codegenErrors).toEqual([]);
    expect(report.totals.schemaViolations).toBe(0);
    expect(report.totals.semanticViolations).toBe(0);
    expect(existsSync(join(tmpDir, 'bag.kern'))).toBe(false);
  });

  it('fails import --check on unmapped TypeScript', () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'bad.ts');
    writeFileSync(sourceFile, 'debugger;\n');
    const getExitCode = trapExit();

    expect(() => runImport(['import', sourceFile, '--check'])).toThrow('EXIT:1');

    expect(getExitCode()).toBe(1);
    expect(logs.join('\n')).toContain('unmapped=1');
    expect(logs.join('\n')).toContain('debugger');
    expect(errors.join('\n')).toContain('Import check failed');
    expect(existsSync(join(tmpDir, 'bad.kern'))).toBe(false);
  });

  it('emits JSON before failing import --check', () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'bad-json.ts');
    writeFileSync(sourceFile, 'debugger;\n');
    const getExitCode = trapExit();

    expect(() => runImport(['import', sourceFile, '--json', '--check'])).toThrow('EXIT:1');

    const report = JSON.parse(logs.join('\n'));
    expect(getExitCode()).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.files[0].unmapped[0]).toContain('debugger');
    expect(report.files[0].diagnostics).toEqual([]);
  });

  it('compiles MCP sources through kern compile --target=mcp', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'echo.kern');
    writeFileSync(
      sourceFile,
      [
        'mcp name=Echo version=1.0',
        '',
        '  tool name=echo',
        '    description text="Echo a message"',
        '    param name=msg type=string required=true',
        '    guard type=sanitize param=msg',
        '    handler <<<',
        '      return { content: [{ type: "text" as const, text: "echo:" + args.msg }] };',
        '    >>>',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'mcp-out');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=mcp', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const compiledFile = join(generatedDir, 'echo.ts');
    expect(existsSync(compiledFile)).toBe(true);
    const compiled = readFileSync(compiledFile, 'utf-8');
    expect(compiled).toContain('@generated by kern');
    expect(compiled).toContain('@kern-source: echo:1');
    expect(compiled).toContain('McpServer');
    expect(compiled).toContain('"echo"');
    expect(compiled).toContain('echo:');
    expect(logs.join('\n')).toContain('Compiled 1/1 files (target: mcp)');
    expect(errors).toEqual([]);
  });

  it('auto-detects Ink from package.json when no kern.config.ts exists', () => {
    process.chdir(tmpDir);

    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'agon-cli',
          bin: { agon: './dist/index.js' },
          dependencies: { ink: '^7.0.0', react: '^19.2.0' },
        },
        null,
        2,
      ),
    );

    const cfg = loadConfig();
    expect(cfg.target).toBe('ink');
  });

  it('does not auto-detect Ink for mixed React repos without CLI metadata', () => {
    process.chdir(tmpDir);

    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'mixed-app',
          dependencies: { ink: '^7.0.0', react: '^19.2.0' },
        },
        null,
        2,
      ),
    );

    const cfg = loadConfig();
    expect(cfg.target).toBe('web');
  });

  it('detects version drift when the generated stamp follows a shebang', () => {
    process.chdir(tmpDir);

    const outFile = join(tmpDir, 'agon-ui.entry.tsx');
    writeFileSync(
      outFile,
      ['#!/usr/bin/env node', '// @generated by kern v999.0.0 — DO NOT EDIT. Source: tests', 'console.log("hi");'].join(
        '\n',
      ),
    );

    checkVersionDrift(outFile, 'agon-ui.kern');
    expect(warnings.join('\n')).toContain('existing output was generated by kern v999.0.0');
  });

  it('compiles Ink sources with a runnable companion entry and executes the generated app', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'agon-ui.kern');
    writeFileSync(
      sourceFile,
      [
        'screen name=AgonCli',
        '  state name=busy initial=true',
        '  on event=key key=return batch=true',
        '    handler <<<',
        '      setBusy(false);',
        '    >>>',
        '  conditional if={{ busy }}',
        '    spinner message="Dispatching engines..." color=214',
        '  text value="Ready"',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'ink-out');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=ink', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const componentFile = join(generatedDir, 'agon-ui.tsx');
    const entryFile = join(generatedDir, 'agon-ui.entry.tsx');
    expect(existsSync(componentFile)).toBe(true);
    expect(existsSync(entryFile)).toBe(true);

    const componentSource = readFileSync(componentFile, 'utf-8');
    const entrySource = readFileSync(entryFile, 'utf-8');
    expect(componentSource).toContain('@kern-source: agon-ui:1');
    expect(componentSource).toContain('export function AgonCli()');
    expect(componentSource).toContain('useInput');
    expect(entrySource).toContain('@kern-source: agon-ui:1');
    expect(entrySource).toContain("import { AgonCli } from './agon-ui.js'");
    expect(entrySource).toContain('render(<AgonCli />)');
    expect(entrySource).toContain('waitUntilExit()');

    transpileTsModule(componentFile);
    const entryJs = transpileTsModule(entryFile);
    installInkRuntimeStubs(generatedDir);

    const runtime = spawnSync(process.execPath, [entryJs], {
      cwd: generatedDir,
      encoding: 'utf-8',
    });

    expect(runtime.status).toBe(0);
    expect(runtime.stderr).toBe('');
    expect(runtime.stdout).toContain('"event":"render"');
    expect(runtime.stdout).toContain('Dispatching engines...');
    expect(runtime.stdout).toContain('Ready');
    expect(runtime.stdout).toContain('"event":"waitUntilExit"');
  });

  it('compiles top-level React hook nodes through target auto/lib output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'music-generation-quota.kern');
    writeFileSync(
      sourceFile,
      [
        'import from="@audiofacets/types" names="MusicGenerationQuota" types=true',
        '',
        'hook name=useMusicGenerationQuota params="enabled:boolean,onQuota:(quota:MusicGenerationQuota|null)=>void" returns="{ refreshQuota: () => void }"',
        '  callback name=refreshQuota params="" deps="enabled,onQuota"',
        '    handler <<<',
        '      if (!enabled) {',
        '        onQuota(null);',
        '        return;',
        '      }',
        '      void window.api.musicGenerationQuota().then(onQuota).catch(() => onQuota(null));',
        '    >>>',
        '  effect deps=refreshQuota',
        '    handler <<<',
        '      refreshQuota();',
        '    >>>',
        '  returns names=refreshQuota',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=auto', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const compiled = readFileSync(join(generatedDir, 'music-generation-quota.ts'), 'utf-8');
    expect(compiled).toContain('@kern-source: music-generation-quota:3');
    expect(compiled).toContain('export function useMusicGenerationQuota');
    expect(compiled).toContain('const refreshQuota = useCallback');
    expect(compiled).toContain('useEffect(() =>');
    expect(compiled).toContain('return { refreshQuota };');
  });
});
