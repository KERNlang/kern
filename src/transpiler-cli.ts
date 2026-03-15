import type { IRNode, TranspileResult, SourceMapEntry, GeneratedArtifact } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { countTokens, serializeIR, camelKey } from './utils.js';

/**
 * CLI Transpiler — generates Commander.js TypeScript from Kern IR
 *
 * Node types handled:
 * - cli      → program setup, global flags, entry point
 * - command  → subcommand with args, flags, handler
 * - arg      → positional argument (.argument())
 * - flag     → option flag (.option() / .requiredOption())
 * - import   → import statement for handler dependencies
 * - handler  → action callback code (from <<< >>> blocks)
 *
 * Frontend/backend nodes are silently ignored.
 */

// ── Types ────────────────────────────────────────────────────────────────

interface ArgInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
}

interface FlagInfo {
  name: string;
  alias?: string;
  type: string;
  required: boolean;
  description: string;
  defaultValue?: string;
}

interface ImportInfo {
  from: string;
  names: string[];
}

interface CommandInfo {
  name: string;
  description: string;
  alias?: string;
  args: ArgInfo[];
  flags: FlagInfo[];
  imports: ImportInfo[];
  handlerCode: string;
}

interface CliInfo {
  name: string;
  version: string;
  description: string;
  globalFlags: FlagInfo[];
  globalImports: ImportInfo[];
  commands: CommandInfo[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function pascalCase(text: string): string {
  const camel = camelKey(text);
  return camel ? camel.charAt(0).toUpperCase() + camel.slice(1) : 'Command';
}

function extractCli(root: IRNode): CliInfo {
  const p = getProps(root);
  const cli: CliInfo = {
    name: (p.name as string) || 'app',
    version: (p.version as string) || '1.0.0',
    description: (p.description as string) || '',
    globalFlags: [],
    globalImports: [],
    commands: [],
  };

  if (!root.children) return cli;

  for (const child of root.children) {
    if (child.type === 'command') {
      cli.commands.push(extractCommand(child));
    } else if (child.type === 'flag') {
      cli.globalFlags.push(extractFlag(child));
    } else if (child.type === 'import') {
      cli.globalImports.push(extractImport(child));
    }
  }

  return cli;
}

function extractCommand(node: IRNode): CommandInfo {
  const p = getProps(node);
  const cmd: CommandInfo = {
    name: (p.name as string) || 'command',
    description: (p.description as string) || '',
    alias: p.alias as string | undefined,
    args: [],
    flags: [],
    imports: [],
    handlerCode: '',
  };

  if (!node.children) return cmd;

  // Validate: no required arg after optional arg
  let seenOptional = false;
  for (const child of node.children) {
    if (child.type === 'arg') {
      const arg = extractArg(child);
      if (seenOptional && arg.required) {
        throw new Error(`Command '${cmd.name}': required arg '${arg.name}' after optional arg`);
      }
      if (!arg.required) seenOptional = true;
      cmd.args.push(arg);
    } else if (child.type === 'flag') {
      cmd.flags.push(extractFlag(child));
    } else if (child.type === 'handler') {
      cmd.handlerCode = (getProps(child).code as string) || '';
    } else if (child.type === 'import') {
      cmd.imports.push(extractImport(child));
    }
  }

  // Validate: no duplicate flag names
  const flagNames = new Set<string>();
  for (const flag of cmd.flags) {
    if (flagNames.has(flag.name)) {
      throw new Error(`Command '${cmd.name}': duplicate flag '${flag.name}'`);
    }
    flagNames.add(flag.name);
    if (flag.alias && flagNames.has(flag.alias)) {
      throw new Error(`Command '${cmd.name}': duplicate flag alias '${flag.alias}'`);
    }
    if (flag.alias) flagNames.add(flag.alias);
  }

  return cmd;
}

function extractArg(node: IRNode): ArgInfo {
  const p = getProps(node);
  return {
    name: (p.name as string) || 'arg',
    type: (p.type as string) || 'string',
    required: p.required === 'true' || p.required === true,
    description: (p.description as string) || '',
    defaultValue: p.default as string | undefined,
  };
}

function extractFlag(node: IRNode): FlagInfo {
  const p = getProps(node);
  return {
    name: (p.name as string) || 'flag',
    alias: p.alias as string | undefined,
    type: (p.type as string) || 'string',
    required: p.required === 'true' || p.required === true,
    description: (p.description as string) || '',
    defaultValue: p.default as string | undefined,
  };
}

function extractImport(node: IRNode): ImportInfo {
  const p = getProps(node);
  const names = (p.names as string) || '';
  return {
    from: (p.from as string) || '',
    names: names.split(',').map(n => n.trim()).filter(Boolean),
  };
}

// ── Code generators ──────────────────────────────────────────────────────

function generateEntryFile(cli: CliInfo): string {
  const lines: string[] = [];

  lines.push(`#!/usr/bin/env node`);
  lines.push(`import { Command } from 'commander';`);

  // Import register functions for each command
  for (const cmd of cli.commands) {
    lines.push(`import { register${pascalCase(cmd.name)} } from './commands/${cmd.name}.js';`);
  }

  // Global imports
  for (const imp of cli.globalImports) {
    lines.push(`import { ${imp.names.join(', ')} } from '${imp.from}';`);
  }

  lines.push('');
  lines.push(`const program = new Command();`);
  lines.push(`program`);
  lines.push(`  .name('${cli.name}')`);
  lines.push(`  .version('${cli.version}')`);
  lines.push(`  .description('${cli.description}');`);

  // Global flags
  for (const flag of cli.globalFlags) {
    lines.push('');
    lines.push(generateFlagLine('program', flag));
  }

  lines.push('');

  // Register commands
  for (const cmd of cli.commands) {
    lines.push(`register${pascalCase(cmd.name)}(program);`);
  }

  lines.push('');
  lines.push(`await program.parseAsync();`);

  return lines.join('\n');
}

function generateCommandFile(cmd: CommandInfo): string {
  const lines: string[] = [];

  lines.push(`import type { Command } from 'commander';`);

  // Command-level imports
  for (const imp of cmd.imports) {
    lines.push(`import { ${imp.names.join(', ')} } from '${imp.from}';`);
  }

  lines.push('');
  lines.push(`export function register${pascalCase(cmd.name)}(program: Command): void {`);
  lines.push(`  const cmd = program`);
  lines.push(`    .command('${cmd.name}')`);
  lines.push(`    .description('${cmd.description}');`);

  if (cmd.alias) {
    lines.push(`  cmd.alias('${cmd.alias}');`);
  }

  // Arguments
  for (const arg of cmd.args) {
    const bracket = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
    const parts = [`'${bracket}'`];
    if (arg.description) parts.push(`'${arg.description}'`);
    if (arg.defaultValue !== undefined) parts.push(`'${arg.defaultValue}'`);
    lines.push(`  cmd.argument(${parts.join(', ')});`);
  }

  // Flags
  for (const flag of cmd.flags) {
    lines.push(`  ${generateFlagLine('cmd', flag)}`);
  }

  // Action
  const argNames = cmd.args.map(a => a.name);
  const argTypes = cmd.args.map(a => {
    const tsType = a.type === 'number' ? 'string' : 'string';
    return `${a.name}${a.required ? '' : '?'}: ${tsType}`;
  });

  const optsType = generateOptsType(cmd.flags);

  lines.push(`  cmd.action(async (${argNames.join(', ')}${argNames.length > 0 ? ', ' : ''}opts: ${optsType}) => {`);

  if (cmd.handlerCode) {
    for (const line of cmd.handlerCode.split('\n')) {
      lines.push(`    ${line.trim()}`);
    }
  }

  lines.push(`  });`);
  lines.push(`}`);

  return lines.join('\n');
}

function generateFlagLine(target: string, flag: FlagInfo): string {
  const dashName = flag.name.replace(/([A-Z])/g, '-$1').toLowerCase();
  const aliasPart = flag.alias ? `-${flag.alias}, ` : '';

  let flagStr: string;
  if (flag.type === 'boolean') {
    flagStr = `'${aliasPart}--${dashName}'`;
  } else {
    flagStr = `'${aliasPart}--${dashName} <${flag.type}>'`;
  }

  const parts = [flagStr];
  if (flag.description) parts.push(`'${flag.description}'`);

  // Type coercion for numbers
  if (flag.type === 'number') {
    parts.push('parseFloat');
  }

  if (flag.defaultValue !== undefined) {
    if (flag.type === 'number') {
      parts.push(flag.defaultValue);
    } else if (flag.type === 'boolean') {
      parts.push(flag.defaultValue);
    } else {
      parts.push(`'${flag.defaultValue}'`);
    }
  }

  const method = flag.required ? 'requiredOption' : 'option';
  return `${target}.${method}(${parts.join(', ')});`;
}

function generateOptsType(flags: FlagInfo[]): string {
  if (flags.length === 0) return 'Record<string, unknown>';

  const fields = flags.map(f => {
    const tsType = f.type === 'number' ? 'number' : f.type === 'boolean' ? 'boolean' : 'string';
    const optional = !f.required && f.defaultValue === undefined ? '?' : '';
    return `${f.name}${optional}: ${tsType}`;
  });

  return `{ ${fields.join('; ')} }`;
}

// ── Main export ──────────────────────────────────────────────────────────

export function transpileCliApp(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];

  // Find cli node (could be root or child)
  const cliNode = root.type === 'cli' ? root : root.children?.find(c => c.type === 'cli') || root;
  const cli = extractCli(cliNode);

  sourceMap.push({
    irLine: cliNode.loc?.line || 0,
    irCol: cliNode.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  // Generate entry file
  const entryCode = generateEntryFile(cli);

  // Generate command files
  const artifacts: GeneratedArtifact[] = [];
  for (const cmd of cli.commands) {
    const cmdCode = generateCommandFile(cmd);
    artifacts.push({
      path: `commands/${cmd.name}.ts`,
      content: cmdCode,
      type: 'command',
    });

    sourceMap.push({
      irLine: 0,
      irCol: 1,
      outLine: 1,
      outCol: 1,
    });
  }

  const irText = serializeIR(root);
  const allCode = [entryCode, ...artifacts.map(a => a.content)].join('\n');
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(allCode);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: entryCode,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts,
  };
}
