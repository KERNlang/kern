import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { basename, dirname, join } from 'path';
import * as ts from 'typescript';
import { pathToFileURL } from 'url';
import { parse } from '../../core/src/parser.js';
import { runCompile } from '../src/commands/compile.js';
import { runImport } from '../src/commands/import.js';
import { runSidecarInstall } from '../src/commands/sidecar-install.js';
import {
  checkVersionDrift,
  loadConfig,
  outputBaseNameForTarget,
  parseCompilerVersion,
  pythonModuleName,
} from '../src/shared.js';

describe('kern import/compile commands', () => {
  let cwd: string;
  let tmpDir: string;
  let logs: string[];
  let errors: string[];
  let warnings: string[];
  let stdout: string[];
  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWarn: typeof console.warn;
  let origExit: typeof process.exit;
  let origStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    cwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'kern-cli-import-compile-'));
    logs = [];
    errors = [];
    warnings = [];
    stdout = [];
    origLog = console.log;
    origError = console.error;
    origWarn = console.warn;
    origExit = process.exit;
    origStdoutWrite = process.stdout.write;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exit = origExit;
    process.stdout.write = origStdoutWrite;
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

  async function getFreePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
      const server = createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => {
          if (address && typeof address === 'object') resolvePort(address.port);
          else reject(new Error('failed to allocate a TCP port'));
        });
      });
    });
  }

  function pythonWithFastApi(): string {
    for (const candidate of ['python3', 'python']) {
      const result = spawnSync(candidate, ['-c', 'import fastapi, uvicorn'], { encoding: 'utf-8' });
      if (result.status === 0) return candidate;
    }
    return '';
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

  function expectTsModuleTypechecks(filePath: string, usageSource: string): void {
    const usageFile = join(dirname(filePath), `${basename(filePath, '.ts')}.typecheck.ts`);
    const nodeTypesFile = join(dirname(filePath), 'node-sidecar-runtime.d.ts');
    writeFileSync(usageFile, usageSource);
    writeFileSync(
      nodeTypesFile,
      [
        'declare const process: { env: Record<string, string | undefined> };',
        'declare const Buffer: {',
        '  from(value: ArrayBuffer | Uint8Array | string, encoding?: string): Uint8Array & { toString(encoding?: string): string };',
        '};',
        'declare module "node:child_process" {',
        '  export interface ChildProcessWithoutNullStreams {',
        '    stdin: { writable: boolean; write(data: string, cb: (err?: Error | null) => void): void; on(event: "error", listener: (error: Error) => void): void };',
        '    stdout: { on(event: "error", listener: (error: Error) => void): void };',
        '    stderr: { on(event: "data", listener: (chunk: unknown) => void): void };',
        '    on(event: "error", listener: (error: Error) => void): void;',
        '    on(event: "exit", listener: (code: number | null, signal: string | null) => void): void;',
        '    kill(): void;',
        '  }',
        '  export function spawn(command: string, args: string[], options: unknown): ChildProcessWithoutNullStreams;',
        '}',
        'declare module "node:readline" {',
        '  export function createInterface(options: unknown): {',
        '    on(event: "line", listener: (line: string) => void): void;',
        '    on(event: "close", listener: () => void): void;',
        '  };',
        '}',
      ].join('\n'),
    );
    const program = ts.createProgram([filePath, usageFile, nodeTypesFile], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      diagnostics.map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        const file = diagnostic.file?.fileName ?? '<unknown>';
        return `${file}:${diagnostic.start ?? 0} TS${diagnostic.code}: ${message}`;
      }),
    ).toEqual([]);
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

  it('surfaces semantic validation errors during default compile', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'bad-export.kern');
    writeFileSync(sourceFile, ['module name=bad', '  export names=missing'].join('\n'));

    const generatedDir = join(tmpDir, 'generated');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    expect(errors.join('\n')).toContain('VALIDATION');
    expect(errors.join('\n')).toContain('export-local-unknown-symbol');
    expect(errors.join('\n')).toContain("unknown symbol 'missing'");
    expect(errors.join('\n')).toContain('diagnostic error(s) found');
  });

  it('surfaces semantic validation errors during target compile', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'bad-target-export.kern');
    writeFileSync(sourceFile, ['module name=bad', '  export names=missing'].join('\n'));

    const generatedDir = join(tmpDir, 'generated-target');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=lib', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );

    expect(getExitCode()).toBe(0);
    expect(errors.join('\n')).toContain('VALIDATION');
    expect(errors.join('\n')).toContain('export-local-unknown-symbol');
    expect(errors.join('\n')).toContain('diagnostic error(s) found');
  });

  it('includes semantic validation errors in target JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'bad-target-json.kern');
    writeFileSync(sourceFile, ['module name=bad', '  export names=missing'].join('\n'));

    const generatedDir = join(tmpDir, 'generated-target-json');
    const getExitCode = trapExit();
    await expect(
      runCompile(['compile', sourceFile, '--target=lib', '--json', `--outdir=${generatedDir}`]),
    ).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(1);
    expect(report.files).toHaveLength(1);
    expect(report.files[0].success).toBe(false);
    expect(report.files[0].schemaViolations[0].message).toContain('export-local-unknown-symbol');
  });

  it('includes extern package boundaries in target JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'extern-target-json.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=app',
        '  extern package=react registry=npm target=react version=18 review=known reason=ui',
        '    import default=React names=useState',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-extern-target-json');
    const getExitCode = trapExit();
    await expect(
      runCompile(['compile', sourceFile, '--target=lib', '--json', `--outdir=${generatedDir}`]),
    ).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(0);
    expect(report.files).toHaveLength(1);
    expect(report.files[0].externalBoundaries).toEqual([
      {
        package: 'react',
        registry: 'npm',
        target: 'react',
        targetFamily: 'ts',
        version: '18',
        review: 'known',
        reason: 'ui',
        effects: [],
        requiresSidecar: false,
        imports: [
          {
            default: 'React',
            names: ['useState'],
            types: false,
            line: 3,
            col: 5,
          },
        ],
        line: 2,
        col: 3,
      },
    ]);
    expect(report.files[0].capabilityIslands).toEqual([]);
    expect(readFileSync(join(generatedDir, 'extern-target-json.ts'), 'utf-8')).toContain(
      "import React, { useState } from 'react';",
    );
  });

  it('includes capability islands in target JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'island-target-json.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=engines',
        '  island engine OpenCode runtime=node effects=[exec,stream,fs] serialization=stream requiresSidecar=true',
        '    import npm "opencode" as opencode',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-island-target-json');
    const getExitCode = trapExit();
    await expect(
      runCompile(['compile', sourceFile, '--target=lib', '--json', `--outdir=${generatedDir}`]),
    ).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(0);
    expect(report.files[0].capabilityIslands).toMatchObject([
      {
        name: 'OpenCode',
        kind: 'engine',
        runtime: 'node',
        effects: ['exec', 'stream', 'fs'],
        serialization: 'stream',
        requiresSidecar: true,
        imports: [
          {
            package: 'opencode',
            registry: 'npm',
            effects: ['exec', 'stream', 'fs'],
            requiresSidecar: true,
          },
        ],
      },
    ]);
    expect(report.files[0].externalBoundaries).toMatchObject([
      {
        package: 'opencode',
        island: { name: 'OpenCode', kind: 'engine', requiresSidecar: true },
        runtime: 'node',
        effects: ['exec', 'stream', 'fs'],
        serialization: 'stream',
        requiresSidecar: true,
      },
    ]);
    expect(readFileSync(join(generatedDir, 'island-target-json.ts'), 'utf-8')).toContain(
      "import opencode from 'opencode';",
    );
  });

  it('includes Python sidecar manifests and emits TS placeholders in target JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'python-sidecar-target-json.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=audio',
        '  island sidecar Demucs runtime=python effects=[fs,exec,stream] serialization=handle requiresSidecar=true',
        '    import py "demucs" as demucs',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-python-sidecar-target-json');
    const getExitCode = trapExit();
    await expect(
      runCompile(['compile', sourceFile, '--target=lib', '--json', `--outdir=${generatedDir}`]),
    ).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(0);
    expect(report.files[0].sidecarManifests).toMatchObject([
      {
        name: 'Demucs',
        kind: 'sidecar',
        runtime: 'python',
        effects: ['fs', 'exec', 'stream'],
        serialization: 'handle',
        requiresSidecar: true,
        packages: [{ package: 'demucs', registry: 'pypi', targetFamily: 'python' }],
      },
    ]);
    const compiled = readFileSync(join(generatedDir, 'python-sidecar-target-json.ts'), 'utf-8');
    expect(compiled).toContain('export const demucsSidecarManifest = {');
    expect(compiled).toContain('export const demucsSidecarClient = createDemucsSidecarClient(demucsSidecarManifest);');
    expect(compiled).toContain('packages: ["demucs"],');
    expect(compiled.match(/export const demucsSidecarManifest/g)).toHaveLength(1);
    expect(compiled.match(/export const demucsSidecarClient/g)).toHaveLength(1);
    expect(compiled).not.toContain("from 'demucs'");
    expect(readFileSync(join(generatedDir, 'kern-sidecar-requirements.txt'), 'utf-8')).toBe('demucs\n');
    expect(JSON.parse(readFileSync(join(generatedDir, 'kern-sidecars.json'), 'utf-8')).sidecars).toHaveLength(1);
  });

  it('includes Python sidecar manifests and emits TS placeholders in default JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'python-sidecar-default-json.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=audio',
        '  island sidecar Demucs runtime=python effects=[fs,exec,stream] serialization=handle requiresSidecar=true',
        '    import py "demucs" as demucs',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-python-sidecar-default-json');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--json', `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(0);
    expect(report.files[0].sidecarManifests).toMatchObject([
      {
        name: 'Demucs',
        runtime: 'python',
        requiresSidecar: true,
        packages: [{ package: 'demucs', registry: 'pypi', targetFamily: 'python' }],
      },
    ]);
    const compiled = readFileSync(join(generatedDir, 'python-sidecar-default-json.ts'), 'utf-8');
    expect(compiled.match(/export const demucsSidecarManifest/g)).toHaveLength(1);
    expect(compiled.match(/export const demucsSidecarClient/g)).toHaveLength(1);
    expect(compiled).not.toContain("from 'demucs'");
    expect(readFileSync(join(generatedDir, 'kern-sidecar-requirements.txt'), 'utf-8')).toBe('demucs\n');
  });

  it('aggregates sidecar install files for multi-file compiles', async () => {
    process.chdir(tmpDir);

    const sourceDir = join(tmpDir, 'multi-sidecar');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'audio.kern'),
      [
        'module name=audio',
        '  import py "demucs" as demucs',
        '  fn name=separate returns=unknown',
        '    handler lang=kern',
        '      return value="demucs"',
      ].join('\n'),
    );
    writeFileSync(
      join(sourceDir, 'matrix.kern'),
      [
        'module name=matrix',
        '  import py "numpy" as np version=1.26',
        '  fn name=zeros returns=unknown',
        '    handler lang=kern',
        '      return value="np"',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-multi-sidecar');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceDir, '--json', `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');
    expect(getExitCode()).toBe(0);

    expect(readFileSync(join(generatedDir, 'kern-sidecar-requirements.txt'), 'utf-8')).toBe('demucs\nnumpy==1.26\n');
    const manifest = JSON.parse(readFileSync(join(generatedDir, 'kern-sidecars.json'), 'utf-8'));
    expect(
      manifest.sidecars.map((sidecar: { packages: Array<{ package: string }> }) => sidecar.packages[0].package).sort(),
    ).toEqual(['demucs', 'numpy']);
  });

  it('removes stale sidecar requirement files when dependencies become stdlib-only', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'stale-sidecar.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=stale',
        '  import py "demucs" as demucs',
        '  fn name=current returns=unknown',
        '    handler lang=kern',
        '      return value="demucs"',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-stale-sidecar');
    let getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--json', `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');
    expect(getExitCode()).toBe(0);
    expect(readFileSync(join(generatedDir, 'kern-sidecar-requirements.txt'), 'utf-8')).toBe('demucs\n');

    stdout = [];
    writeFileSync(
      sourceFile,
      [
        'module name=stale',
        '  import py "datetime" as dt',
        '  fn name=current returns=unknown',
        '    handler lang=kern',
        '      return value="dt"',
      ].join('\n'),
    );

    getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--json', `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');
    expect(getExitCode()).toBe(0);
    expect(existsSync(join(generatedDir, 'kern-sidecar-requirements.txt'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(generatedDir, 'kern-sidecars.json'), 'utf-8'));
    expect(manifest.sidecars).toMatchObject([{ packages: [{ package: 'datetime' }] }]);
  });

  it('prints the explicit sidecar install command in dry-run mode', () => {
    process.chdir(tmpDir);
    const generatedDir = join(tmpDir, 'generated-sidecar-install');
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(join(generatedDir, 'kern-sidecar-requirements.txt'), 'demucs\n');

    runSidecarInstall(['sidecar-install', `--outdir=${generatedDir}`, '--python=python-test', '--dry-run']);

    expect(logs).toEqual([`python-test -m pip install -r ${join(generatedDir, 'kern-sidecar-requirements.txt')}`]);
  });

  it('executes generated Python sidecar calls over stdio JSON RPC', async () => {
    const python =
      spawnSync('python3', ['-c', 'import math; print(math.sqrt(49))'], { encoding: 'utf-8' }).status === 0
        ? 'python3'
        : spawnSync('python', ['-c', 'import math; print(math.sqrt(49))'], { encoding: 'utf-8' }).status === 0
          ? 'python'
          : '';
    if (!python) return;
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'python-sidecar-runtime.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=audio',
        '  island sidecar Math runtime=python effects=[cpu] serialization=json requiresSidecar=true',
        '    import py "math" as math',
        '    import py "builtins" as builtins',
        '    import py "badstream" as badstream',
      ].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'badstream.py'),
      [
        'def boom():',
        '    yield 1',
        '    raise RuntimeError("stream exploded")',
        'def noisy():',
        '    print("not protocol json")',
        '    yield b"AB"',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-python-sidecar-runtime');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--json', `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');
    expect(getExitCode()).toBe(0);

    const compiledFile = join(generatedDir, 'python-sidecar-runtime.ts');
    const compiledJs = transpileTsModule(compiledFile);
    writeFileSync(join(generatedDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

    const previousPython = process.env.KERN_PYTHON;
    const previousPythonPath = process.env.PYTHONPATH;
    process.env.KERN_PYTHON = python;
    process.env.PYTHONPATH = previousPythonPath ? `${tmpDir}:${previousPythonPath}` : tmpDir;
    type PythonFunction = ((...args: unknown[]) => Promise<unknown>) & {
      kwargs(kwargs: Record<string, unknown>, ...args: unknown[]): Promise<unknown>;
    };
    const mod = (await import(pathToFileURL(compiledJs).href)) as {
      mathSidecarClient: {
        module(moduleName: string): Record<string, PythonFunction>;
        bind(moduleName: string, method: string): PythonFunction;
        call(
          moduleName: string,
          method: string,
          payload?: { args?: unknown[]; kwargs?: Record<string, unknown> },
        ): Promise<unknown>;
        stream(
          moduleName: string,
          method: string,
          payload?: { args?: unknown[]; kwargs?: Record<string, unknown> },
        ): AsyncGenerator<unknown>;
        close(): void;
        dispose(): void;
      };
      math: Record<string, PythonFunction>;
      builtins: Record<string, PythonFunction>;
      badstream: Record<string, PythonFunction>;
    };
    try {
      process.env.KERN_PYTHON = join(tmpDir, 'missing-python');
      await expect(mod.mathSidecarClient.call('math', 'sqrt', { args: [49] })).rejects.toThrow();
      process.env.KERN_PYTHON = python;
      await expect(mod.mathSidecarClient.call('math', 'sqrt', { args: [49] })).resolves.toBe(7);
      await expect(mod.math.sqrt(49)).resolves.toBe(7);
      await expect(mod.mathSidecarClient.module('math').sqrt(36)).resolves.toBe(6);
      await expect(mod.mathSidecarClient.bind('math', 'sqrt')(25)).resolves.toBe(5);
      await expect(mod.builtins.print('stdout noise')).resolves.toBeNull();
      await expect(mod.builtins.sorted.kwargs({ reverse: true }, [3, 1, 2])).resolves.toEqual([3, 2, 1]);
      await expect(mod.builtins.bytes([65, 66, 67])).resolves.toEqual(Uint8Array.from([65, 66, 67]));
      await expect(mod.builtins.len(Uint8Array.from([1, 2, 3]))).resolves.toBe(3);
      const streamed: unknown[] = [];
      for await (const item of mod.mathSidecarClient.stream('builtins', 'range', { args: [3] })) streamed.push(item);
      expect(streamed).toEqual([0, 1, 2]);
      const singleStreamed: unknown[] = [];
      for await (const item of mod.mathSidecarClient.stream('math', 'sqrt', { args: [9] })) singleStreamed.push(item);
      expect(singleStreamed).toEqual([3]);
      const failedStream = mod.mathSidecarClient.stream('badstream', 'boom');
      await expect(async () => {
        for await (const _item of failedStream) {
          // consume until the Python generator raises
        }
      }).rejects.toThrow('stream exploded');
      const noisyStreamed: unknown[] = [];
      for await (const item of mod.mathSidecarClient.stream('badstream', 'noisy')) noisyStreamed.push(item);
      expect(noisyStreamed).toEqual([Uint8Array.from([65, 66])]);
      await expect(mod.mathSidecarClient.call('math', 'missing_function')).rejects.toThrow('missing_function');
      await expect(mod.mathSidecarClient.call('os', 'getcwd')).rejects.toThrow('is not declared');
    } finally {
      mod.mathSidecarClient.dispose();
      if (previousPython === undefined) delete process.env.KERN_PYTHON;
      else process.env.KERN_PYTHON = previousPython;
      if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = previousPythonPath;
    }
  });

  it('executes top-level Python imports through an implicit sidecar', async () => {
    const python =
      spawnSync('python3', ['-c', 'import math; print(math.sqrt(49))'], { encoding: 'utf-8' }).status === 0
        ? 'python3'
        : spawnSync('python', ['-c', 'import math; print(math.sqrt(49))'], { encoding: 'utf-8' }).status === 0
          ? 'python'
          : '';
    if (!python) return;
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'python-top-level-runtime.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=calc',
        '  import py "math" as math',
        '  import py "math" names=sqrt',
        '  fn name=sqrtSeven async=true returns=Promise<unknown>',
        '    handler lang=kern',
        '      return value="await math.sqrt(49)"',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-python-top-level-runtime');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--json', `--outdir=${generatedDir}`])).rejects.toThrow('EXIT:0');
    expect(getExitCode()).toBe(0);

    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(0);
    expect(report.files[0].sidecarManifests).toMatchObject([
      {
        name: 'Math',
        runtime: 'python',
        requiresSidecar: true,
        packages: [{ package: 'math', registry: 'pypi', targetFamily: 'python' }],
      },
    ]);

    const compiledFile = join(generatedDir, 'python-top-level-runtime.ts');
    const compiled = readFileSync(compiledFile, 'utf-8');
    expect(compiled).toContain('export const math = mathSidecarClient.module("math") as unknown as MathPythonModule;');
    expectTsModuleTypechecks(
      compiledFile,
      [
        'import { math, sqrt } from "./python-top-level-runtime.js";',
        'async function check(): Promise<void> {',
        '  const viaModule: number = await math.sqrt(49);',
        '  const viaModuleKwargs: number = await math.sqrt.kwargs({}, 49);',
        '  const viaModuleKwargsOnly: number = await math.sqrt.kwargs({ x: 49 });',
        '  const viaNamed: number = await sqrt(49);',
        '  const viaNamedKwargs: number = await sqrt.kwargs({}, 49);',
        '  const viaNamedKwargsOnly: number = await sqrt.kwargs({ x: 49 });',
        '  void viaModule;',
        '  void viaModuleKwargs;',
        '  void viaModuleKwargsOnly;',
        '  void viaNamed;',
        '  void viaNamedKwargs;',
        '  void viaNamedKwargsOnly;',
        '}',
        'void check;',
      ].join('\n'),
    );
    expect(existsSync(join(generatedDir, 'kern-sidecars.json'))).toBe(true);
    expect(existsSync(join(generatedDir, 'kern-sidecar-requirements.txt'))).toBe(false);

    const compiledJs = transpileTsModule(compiledFile);
    writeFileSync(join(generatedDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

    const previousPython = process.env.KERN_PYTHON;
    process.env.KERN_PYTHON = python;
    const mod = (await import(pathToFileURL(compiledJs).href)) as {
      sqrtSeven(): Promise<unknown>;
      mathSidecarClient: { dispose(): void };
    };
    try {
      await expect(mod.sqrtSeven()).resolves.toBe(7);
    } finally {
      mod.mathSidecarClient.dispose();
      if (previousPython === undefined) delete process.env.KERN_PYTHON;
      else process.env.KERN_PYTHON = previousPython;
    }
  });

  it('keeps extern package boundaries in strict shadow JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'extern-shadow-json.kern');
    writeFileSync(
      sourceFile,
      [
        'module name=app',
        '  extern package=numpy registry=pypi target=fastapi reason=ml',
        '    import default=np names=array',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-extern-shadow-json');
    const getExitCode = trapExit();
    await expect(
      runCompile([
        'compile',
        sourceFile,
        '--target=lib',
        '--strict-parse',
        '--shadow',
        '--json',
        `--outdir=${generatedDir}`,
      ]),
    ).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.files).toHaveLength(1);
    expect(report.files[0].externalBoundaries).toMatchObject([
      {
        package: 'numpy',
        registry: 'pypi',
        target: 'fastapi',
        targetFamily: 'python',
        reason: 'ml',
        imports: [{ default: 'np', names: ['array'], types: false }],
      },
    ]);
  });

  it('reports declaration-only extern package boundaries in target JSON compile output', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'extern-metadata-json.kern');
    writeFileSync(
      sourceFile,
      ['module name=app', '  extern package=react registry=npm target=react review=known reason=ui'].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-extern-metadata-json');
    const getExitCode = trapExit();
    await expect(
      runCompile(['compile', sourceFile, '--target=lib', '--json', `--outdir=${generatedDir}`]),
    ).rejects.toThrow('EXIT:0');

    expect(getExitCode()).toBe(0);
    const report = JSON.parse(stdout.join(''));
    expect(report.errors).toBe(0);
    expect(report.files[0].externalBoundaries).toMatchObject([
      {
        package: 'react',
        registry: 'npm',
        target: 'react',
        targetFamily: 'ts',
        review: 'known',
        reason: 'ui',
        imports: [{ names: [], types: false }],
      },
    ]);
    expect(readFileSync(join(generatedDir, 'extern-metadata-json.ts'), 'utf-8')).not.toContain("import 'react'");
  });

  it('strict target compile validates resolver-enriched re-exports', async () => {
    process.chdir(tmpDir);

    writeFileSync(
      join(tmpDir, 'parser.kern'),
      ['fn name=parseUser returns=string', '  handler <<<', '    return "ok"', '  >>>'].join('\n'),
    );
    writeFileSync(
      join(tmpDir, 'index.kern'),
      ['module name=index', '  export from="./parser.kern" names=missing'].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated-strict-target');
    const getExitCode = trapExit();
    await expect(
      runCompile(['compile', tmpDir, '--target=lib', '--strict-parse', `--outdir=${generatedDir}`]),
    ).rejects.toThrow('EXIT:1');

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('export-from-unknown-symbol');
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
    expect(report.files[0].kern).toBeUndefined();
    expect(existsSync(join(tmpDir, 'bag.kern'))).toBe(false);
  });

  it('emits stable empty JSON import reports', () => {
    process.chdir(tmpDir);

    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir);

    runImport(['import', emptyDir, '--json']);

    const report = JSON.parse(logs.join('\n'));
    expect(report).toEqual({
      files: [],
      totals: {
        types: 0,
        interfaces: 0,
        functions: 0,
        classes: 0,
        imports: 0,
        constants: 0,
        enums: 0,
        components: 0,
        unmapped: 0,
        diagnostics: 0,
        schemaViolations: 0,
        semanticViolations: 0,
        codegenErrors: 0,
      },
      ok: true,
    });
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

  it('compiles FastAPI sources with python headers and route artifacts', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'health.kern');
    writeFileSync(
      sourceFile,
      [
        'server name=HealthAPI port=3002',
        '  middleware name=cors',
        '  route method=get path=/health',
        '    handler <<<',
        '      return {"status": "ok"}',
        '    >>>',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'fastapi-out');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=fastapi', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const mainFile = join(generatedDir, 'health.py');
    const routePackageFile = join(generatedDir, 'routes/__init__.py');
    const routeFile = join(generatedDir, 'routes/get_health.py');
    expect(existsSync(mainFile)).toBe(true);
    expect(existsSync(routePackageFile)).toBe(true);
    expect(existsSync(routeFile)).toBe(true);

    const main = readFileSync(mainFile, 'utf-8');
    const route = readFileSync(routeFile, 'utf-8');
    expect(main).toContain('# @generated by kern');
    expect(route).toContain('# @generated by kern');
    expect(main).not.toContain('// @generated by kern');
    expect(route).not.toContain('// @generated by kern');
    expect(main).toContain('from routes.get_health import router as get_health_router');
    expect(main).toContain('host=os.environ.get("HOST", "127.0.0.1")');
    expect(main).toContain('allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]');
    expect(main).not.toContain('allow_methods=["*"]');
    expect(main).not.toContain('    from fastapi.responses import JSONResponse');
    expect(route).toContain('router = APIRouter()');
    const pyCompile = spawnSync('python3', ['-m', 'py_compile', mainFile, routePackageFile, routeFile], {
      encoding: 'utf-8',
    });
    expect(pyCompile.status).toBe(0);
    expect(errors).toEqual([]);
  });

  it('sanitizes FastAPI entry filenames into valid Python module names', async () => {
    process.chdir(tmpDir);

    expect(pythonModuleName('class')).toBe('class_');
    expect(pythonModuleName('2-service')).toBe('_2_service');
    expect(pythonModuleName('')).toBe('main');
    expect(pythonModuleName('json')).toBe('json_');
    expect(pythonModuleName('auth')).toBe('auth_');
    expect(pythonModuleName('routes')).toBe('routes_');
    expect(pythonModuleName('__init__')).toBe('__init___');
    expect(outputBaseNameForTarget('my-api', 'fastapi')).toBe('my_api');
    expect(outputBaseNameForTarget('my-api', 'cli')).toBe('my-api');

    const sourceFile = join(tmpDir, 'my-api.kern');
    writeFileSync(sourceFile, 'server name=HealthAPI port=3002');

    const generatedDir = join(tmpDir, 'fastapi-sanitized-out');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=fastapi', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const sanitizedFile = join(generatedDir, 'my_api.py');
    expect(existsSync(sanitizedFile)).toBe(true);
    expect(existsSync(join(generatedDir, 'my-api.py'))).toBe(false);

    const pyCompile = spawnSync('python3', ['-m', 'py_compile', sanitizedFile], { encoding: 'utf-8' });
    expect(pyCompile.status).toBe(0);
    expect(errors).toEqual([]);
  });

  it('avoids stdlib FastAPI filenames and writes explicit Alembic model modules', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'json.kern');
    writeFileSync(
      sourceFile,
      [
        'model name=User table=users',
        '  column name=id type=uuid primary=true',
        'server name=StdlibAPI port=3004',
      ].join('\n'),
    );

    const generatedDir = join(tmpDir, 'fastapi-stdlib-out');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=fastapi', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const sanitizedFile = join(generatedDir, 'json_.py');
    const envFile = join(generatedDir, 'alembic/env.py');
    expect(existsSync(sanitizedFile)).toBe(true);
    expect(existsSync(join(generatedDir, 'json.py'))).toBe(false);

    const env = readFileSync(envFile, 'utf-8');
    expect(env).toContain('model_modules = ["json_"]');
    expect(env).toContain('importlib.import_module(module_name)');
    expect(env).not.toContain('importlib.import_module(module_path.stem)');
    expect(readFileSync(join(generatedDir, 'alembic.ini'), 'utf-8')).toContain('sqlalchemy.url = sqlite:///./app.db');
    expect(readFileSync(sanitizedFile, 'utf-8')).toContain('# @generated by kern');

    writeFileSync(join(generatedDir, 'notes.py'), 'raise RuntimeError("should not be imported")\n');
    writeFileSync(join(generatedDir, 'users_extra.py'), '# @generated by kern\nMODEL = True\n');
    writeFileSync(join(generatedDir, 'broken.py'), Buffer.from([0xff, 0xfe, 0xfd]));
    const scanStart = env.indexOf('model_modules = ');
    const scanEnd = env.indexOf('for module_name in model_modules:');
    expect(scanStart).toBeGreaterThanOrEqual(0);
    expect(scanEnd).toBeGreaterThan(scanStart);
    const scanSnippet = env.slice(scanStart, scanEnd);
    const pythonScan = [
      'from pathlib import Path',
      `app_dir = Path(${JSON.stringify(generatedDir)})`,
      scanSnippet,
      'print("\\n".join(model_modules))',
    ].join('\n');
    const scanResult = spawnSync('python3', ['-c', pythonScan], { encoding: 'utf-8' });
    expect(scanResult.status).toBe(0);
    const headerDiscoveredModules = scanResult.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(headerDiscoveredModules).toEqual(expect.arrayContaining(['json_', 'users_extra']));
    expect(headerDiscoveredModules).not.toEqual(expect.arrayContaining(['notes', 'broken']));

    const pyCompile = spawnSync('python3', ['-m', 'py_compile', sanitizedFile, envFile], { encoding: 'utf-8' });
    expect(pyCompile.status).toBe(0);
    expect(errors).toEqual([]);
  });

  it('avoids Python keyword FastAPI entry filenames', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'class.kern');
    writeFileSync(sourceFile, 'server name=KeywordAPI port=3003');

    const generatedDir = join(tmpDir, 'fastapi-keyword-out');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=fastapi', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const sanitizedFile = join(generatedDir, 'class_.py');
    expect(existsSync(sanitizedFile)).toBe(true);
    expect(existsSync(join(generatedDir, 'class.py'))).toBe(false);

    const pyCompile = spawnSync('python3', ['-m', 'py_compile', sanitizedFile], { encoding: 'utf-8' });
    expect(pyCompile.status).toBe(0);
    expect(errors).toEqual([]);
  });

  it('boots generated FastAPI worker app from a sanitized module filename', async () => {
    const python = pythonWithFastApi();
    if (!python) {
      if (process.env.CI) throw new Error('FastAPI worker smoke test requires python with fastapi and uvicorn');
      return;
    }
    process.chdir(tmpDir);

    writeFileSync(
      join(tmpDir, 'kern.config.ts'),
      [
        'export default {',
        "  target: 'fastapi',",
        "  fastapi: { security: 'relaxed', uvicorn: { workers: 2 } },",
        '};',
      ].join('\n'),
    );
    const sourceFile = join(tmpDir, 'my-api.kern');

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await getFreePort();
      writeFileSync(
        sourceFile,
        [
          `server name=HealthAPI port=${port}`,
          '  route method=get path=/health',
          '    handler <<<',
          '      return {"ok": True}',
          '    >>>',
        ].join('\n'),
      );

      const generatedDir = join(tmpDir, `fastapi-worker-smoke-out-${attempt}`);
      const getExitCode = trapExit();
      await expect(runCompile(['compile', sourceFile, '--target=fastapi', `--outdir=${generatedDir}`])).rejects.toThrow(
        'EXIT:0',
      );
      expect(getExitCode()).toBe(0);

      const mainFile = join(generatedDir, 'my_api.py');
      const child = spawn(python, [mainFile], {
        cwd: dirname(tmpDir),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      const output: string[] = [];
      child.stdout.on('data', (chunk) => output.push(String(chunk)));
      child.stderr.on('data', (chunk) => output.push(String(chunk)));

      try {
        const deadline = Date.now() + 15_000;
        let responseJson: unknown;
        while (Date.now() < deadline) {
          if (child.exitCode !== null) throw new Error(`server exited early\n${output.join('')}`);
          try {
            const controller = new AbortController();
            const fetchTimeout = setTimeout(() => controller.abort(), 2_000);
            try {
              const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
              if (response.ok) {
                responseJson = await response.json();
                break;
              }
            } finally {
              clearTimeout(fetchTimeout);
            }
          } catch {
            // Server process is still starting.
          }
          await new Promise((resolveTimer) => setTimeout(resolveTimer, 150));
        }
        if (responseJson === undefined)
          throw new Error(`timed out waiting for generated FastAPI worker\n${output.join('')}`);
        expect(responseJson).toEqual({ ok: true });
        return;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('address already in use') && !message.includes('timed out waiting')) throw err;
      } finally {
        if (child.exitCode === null) {
          try {
            child.kill('SIGTERM');
          } catch {
            // Process already exited between the status check and signal.
          }
          await new Promise<void>((resolveClose) => {
            if (child.exitCode !== null) {
              resolveClose();
              return;
            }
            const timeout = setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // Process already exited before the hard kill.
              }
              resolveClose();
            }, 3_000);
            child.once('close', () => {
              clearTimeout(timeout);
              resolveClose();
            });
          });
        }
      }
    }
    throw lastError;
  }, 50_000);

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

  it('parses prerelease canary compiler versions for drift checks', () => {
    expect(parseCompilerVersion('3.4.2-canary.2.1.ae371d54')).toEqual([3, 4, 2]);
    expect(parseCompilerVersion('3.4.2-canary.2.1.ae371d54+build.5')).toEqual([3, 4, 2]);
  });

  it('does not rewrite generated files when only the header version changed', async () => {
    process.chdir(tmpDir);

    const sourceFile = join(tmpDir, 'stable.kern');
    writeFileSync(
      sourceFile,
      ['fn name=hello returns=string', '  handler <<<', '    return "hi";', '  >>>'].join('\n'),
    );

    const generatedDir = join(tmpDir, 'generated');
    const getExitCode = trapExit();
    await expect(runCompile(['compile', sourceFile, '--target=lib', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );
    expect(getExitCode()).toBe(0);

    const compiledFile = join(generatedDir, 'stable.ts');
    const compiled = readFileSync(compiledFile, 'utf-8');
    const oldStamped = compiled.replace(/@generated by kern v\d+\.\d+\.\d+/, '@generated by kern v0.0.0');
    writeFileSync(compiledFile, oldStamped);
    warnings = [];

    await expect(runCompile(['compile', sourceFile, '--target=lib', `--outdir=${generatedDir}`])).rejects.toThrow(
      'EXIT:0',
    );

    expect(readFileSync(compiledFile, 'utf-8')).toBe(oldStamped);
    expect(warnings.join('\n')).not.toContain('kern-compiler-drift');
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
