import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { PassThrough } from 'stream';
import * as ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NODE_MAJOR = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
const runtimeTest = NODE_MAJOR >= 22 ? test : test.skip;

function transpileTsModule(filePath: string): string {
  const source = readFileSync(filePath, 'utf-8');
  const outputPath = filePath.replace(/\.tsx?$/, '.js');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filePath,
  });
  writeFileSync(outputPath, result.outputText);
  return outputPath;
}

class TtyInput extends PassThrough {
  isTTY = true;

  setRawMode(_value: boolean): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

class TtyOutput extends PassThrough {
  isTTY = true;
  columns = 80;
  rows = 24;

  cursorTo(): boolean {
    return true;
  }

  moveCursor(): boolean {
    return true;
  }

  clearLine(): boolean {
    return true;
  }

  clearScreenDown(): boolean {
    return true;
  }

  getColorDepth(): number {
    return 8;
  }

  hasColors(): boolean {
    return true;
  }
}

async function waitUntilExitOrTimeout(waitUntilExit: Promise<unknown>, timeoutMs = 1500): Promise<void> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      waitUntilExit.then(() => undefined),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Timed out waiting for Ink app exit after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function waitForText(readText: () => string, expected: string, timeoutMs = 1500, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (readText().includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for output to contain '${expected}'. Current output:\n${readText()}`);
}

describe('Ink runtime integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(ROOT, '.ink-runtime-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  runtimeTest('generated Ink entry boots against the real runtime and exits cleanly', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');

    const source = ['screen name=RealInkApp', '  app-exit on=true', '  text value="Real Ink Ready"'].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);

    const component = result.artifacts?.find((artifact) => artifact.type === 'component');
    const entry = result.artifacts?.find((artifact) => artifact.type === 'entry');

    expect(component).toBeDefined();
    expect(entry).toBeDefined();

    const packageJsonPath = join(tempDir, 'package.json');
    writeFileSync(packageJsonPath, JSON.stringify({ type: 'module' }, null, 2));

    const componentPath = join(tempDir, component!.path);
    const entryPath = join(tempDir, entry!.path);
    writeFileSync(componentPath, component!.content);
    writeFileSync(entryPath, entry!.content);

    transpileTsModule(componentPath);
    const entryJsPath = transpileTsModule(entryPath);

    const runtime = spawnSync(process.execPath, [entryJsPath], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        CI: '1',
        TERM: process.env.TERM || 'xterm-256color',
      },
    });

    if (runtime.status !== 0) {
      throw new Error(
        [
          `Ink runtime exited with status ${String(runtime.status)}`,
          `execPath=${process.execPath}`,
          `node=${process.version}`,
          `stderr=${runtime.stderr}`,
          `stdout=${runtime.stdout}`,
        ].join('\n'),
      );
    }
    expect(runtime.stderr).toBe('');
    expect(runtime.stdout).toContain('Real Ink Ready');
  });

  runtimeTest('generated Ink component handles Enter via real useInput and exits after state update', async () => {
    const React = (await import('react')).default;
    const { render } = await import('ink');
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');

    const source = [
      'screen name=InteractiveInkApp',
      '  state name=mode initial="waiting"',
      '  state name=complete initial=false',
      '  on event=key key=return batch=true',
      '    handler <<<',
      '      setMode("ready");',
      '      setComplete(true);',
      '    >>>',
      '  app-exit on={{ complete }}',
      '  text value={{ mode }}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    const component = result.artifacts?.find((artifact) => artifact.type === 'component');

    expect(component).toBeDefined();

    const packageJsonPath = join(tempDir, 'package.json');
    writeFileSync(packageJsonPath, JSON.stringify({ type: 'module' }, null, 2));

    const componentPath = join(tempDir, component!.path);
    writeFileSync(componentPath, component!.content);
    const componentJsPath = transpileTsModule(componentPath);
    const componentModule = await import(pathToFileURL(componentJsPath).href);
    const Component = componentModule.InteractiveInkApp as any;

    const stdin = new TtyInput();
    const stdout = new TtyOutput();
    const stderr = new TtyOutput();
    let stdoutText = '';
    let stderrText = '';
    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');
    stdout.on('data', (chunk: string | Buffer) => {
      stdoutText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    stderr.on('data', (chunk: string | Buffer) => {
      stderrText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    const app = render(React.createElement(Component), {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      expect(stdoutText).toContain('waiting');

      stdin.write('\r');

      await waitUntilExitOrTimeout(app.waitUntilExit());
      expect(stderrText).toBe('');
      expect(stdoutText).toContain('ready');
    } finally {
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });

  runtimeTest('generated Ink component handles Right Arrow across multiple live input cycles', async () => {
    const React = (await import('react')).default;
    const { render } = await import('ink');
    const { parse } = await import('../../core/src/parser.js');
    const { transpileInk } = await import('../src/transpiler-ink.js');

    const source = [
      'screen name=ArrowInkApp',
      '  state name=count initial=0',
      '  state name=complete initial=false',
      '  on event=key key=right batch=true',
      '    handler <<<',
      '      setCount(count + 1);',
      '      setComplete(count + 1 >= 2);',
      '    >>>',
      '  app-exit on={{ complete }}',
      '  text value={{ String(count) }}',
    ].join('\n');
    const ast = parse(source);
    const result = transpileInk(ast);
    const component = result.artifacts?.find((artifact) => artifact.type === 'component');

    expect(component).toBeDefined();

    const packageJsonPath = join(tempDir, 'package.json');
    writeFileSync(packageJsonPath, JSON.stringify({ type: 'module' }, null, 2));

    const componentPath = join(tempDir, component!.path);
    writeFileSync(componentPath, component!.content);
    const componentJsPath = transpileTsModule(componentPath);
    const componentModule = await import(pathToFileURL(componentJsPath).href);
    const Component = componentModule.ArrowInkApp as any;

    const stdin = new TtyInput();
    const stdout = new TtyOutput();
    const stderr = new TtyOutput();
    let stdoutText = '';
    let stderrText = '';
    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');
    stdout.on('data', (chunk: string | Buffer) => {
      stdoutText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    stderr.on('data', (chunk: string | Buffer) => {
      stderrText += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    const app = render(React.createElement(Component), {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      interactive: true,
      debug: true,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    try {
      await app.waitUntilRenderFlush();
      expect(stdoutText).toContain('0');

      stdin.write('\u001B[C');
      await waitForText(() => stdoutText, '1');

      stdin.write('\u001B[C');
      await waitUntilExitOrTimeout(app.waitUntilExit());

      expect(stderrText).toBe('');
      expect(stdoutText).toContain('2');
    } finally {
      app.cleanup();
      stdin.end();
      stdout.end();
      stderr.end();
    }
  });
});
