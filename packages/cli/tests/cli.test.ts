import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('CLI Transpiler', () => {
  test('generates Commander.js entry with commands', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileCliApp } = await import('../src/transpiler-cli.js');
    const source = readFileSync(resolve(ROOT, 'examples/agon.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileCliApp(ast);

    expect(result.code).toContain("import { Command } from 'commander'");
    expect(result.code).toContain(".name('agon')");
    expect(result.code).toContain(".version('2.0.0')");
    expect(result.code).toContain('parseAsync');
    expect(result.code).toContain('registerForge');
    expect(result.code).toContain('registerBrainstorm');
  });

  test('generates command artifacts with args and flags', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileCliApp } = await import('../src/transpiler-cli.js');
    const source = readFileSync(resolve(ROOT, 'examples/agon.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileCliApp(ast);

    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.length).toBeGreaterThanOrEqual(3);

    const forgeCmd = result.artifacts!.find((a: any) => a.path === 'commands/forge.ts');
    expect(forgeCmd).toBeDefined();
    expect(forgeCmd!.content).toContain("'<task>'");
    expect(forgeCmd!.content).toContain('--timeout');
    expect(forgeCmd!.content).toContain('parseFloat');
    expect(forgeCmd!.content).toContain('runForge');
  });

  test('handler code appears verbatim in action callback', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileCliApp } = await import('../src/transpiler-cli.js');
    const ast = parse('cli name=test\n  command name=hello\n    arg name=name type=string required=true\n    handler <<<\n      console.log(name);\n    >>>');
    const result = transpileCliApp(ast);

    const cmd = result.artifacts!.find((a: any) => a.path === 'commands/hello.ts');
    expect(cmd!.content).toContain('console.log(name)');
  });

  test('global flags generate on program level', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileCliApp } = await import('../src/transpiler-cli.js');
    const ast = parse('cli name=test\n  flag name=verbose alias=v type=boolean description="Verbose"');
    const result = transpileCliApp(ast);

    expect(result.code).toContain('--verbose');
    expect(result.code).toContain('-v');
  });

  test('required flags use requiredOption', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileCliApp } = await import('../src/transpiler-cli.js');
    const ast = parse('cli name=test\n  command name=run\n    flag name=config type=string required=true');
    const result = transpileCliApp(ast);

    const cmd = result.artifacts!.find((a: any) => a.path === 'commands/run.ts');
    expect(cmd!.content).toContain('requiredOption');
  });

  test('dashed flag names produce camelCase opts type', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileCliApp } = await import('../src/transpiler-cli.js');
    const ast = parse('cli name=test\n  command name=run\n    flag name=task-class type=string\n    handler <<<\n      console.log(opts.taskClass);\n    >>>');
    const result = transpileCliApp(ast);

    const cmd = result.artifacts!.find((a: any) => a.path === 'commands/run.ts');
    expect(cmd!.content).toContain('taskClass');
    expect(cmd!.content).not.toContain("task-class?:");
  });
});
