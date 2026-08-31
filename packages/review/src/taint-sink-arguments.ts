import { type CallExpression, Node } from 'ts-morph';
import { commandAcceptsArgIndex } from './taint-command-args.js';
import type { TaintSink } from './taint-types.js';
import { NOSQL_QUERY_ARG_INDEXES } from './taint-types.js';

const COMMAND_SINK_ARGUMENTS: Readonly<Record<string, ReadonlySet<number>>> = {
  exec: new Set([0, 1]),
  execSync: new Set([0, 1]),
  execFile: new Set([0, 1, 2]),
  execFileSync: new Set([0, 1, 2]),
  spawn: new Set([0, 1, 2]),
  spawnSync: new Set([0, 1, 2]),
};

export function acceptsTaintedSinkArgument(
  call: CallExpression,
  category: TaintSink['category'],
  calleeName: string,
  argIndex: number,
): boolean {
  if (category === 'nosql') return NOSQL_QUERY_ARG_INDEXES[calleeName]?.has(argIndex) ?? false;
  if (category !== 'command') return true;
  const argument = call.getArguments()[argIndex];
  if (!argument) return false;
  if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) return false;
  const commandName = calleeName.split('.').at(-1) ?? calleeName;
  const positions = COMMAND_SINK_ARGUMENTS[commandName];
  if (!positions) return true;
  if (!positions.has(argIndex)) return false;
  if (isExecutionOptionsArgument(argIndex, argument)) return true;
  return commandAcceptsArgIndex(call, commandName, argIndex);
}

export function isBenignCommandInputReference(
  category: TaintSink['category'],
  _calleeName: string,
  argIndex: number,
  reference: import('ts-morph').Node,
  argument: import('ts-morph').Node,
): boolean {
  if (category !== 'command') return false;
  if (!isExecutionOptionsArgument(argIndex, argument)) return false;

  let current: import('ts-morph').Node | undefined = reference;
  while (current && current !== argument) {
    const parent: import('ts-morph').Node | undefined = current.getParent();
    if (!parent) return false;
    if (
      (Node.isPropertyAssignment(parent) || Node.isShorthandPropertyAssignment(parent)) &&
      parent.getName() === 'input' &&
      parent.getParent() === argument
    ) {
      return !readsProgramFromStdin(argument);
    }
    current = parent;
  }
  return false;
}

function isExecutionOptionsArgument(argIndex: number, argument: import('ts-morph').Node): boolean {
  return argIndex > 0 && Node.isObjectLiteralExpression(argument);
}

const STDIN_PROGRAM_INTERPRETERS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
  'node',
  'deno',
  'bun',
  'perl',
  'ruby',
  'php',
  'lua',
  'osascript',
]);

function readsProgramFromStdin(optionsArgument: import('ts-morph').Node): boolean {
  const call = optionsArgument.getParent();
  if (!Node.isCallExpression(call)) return false;
  const [executable, argv] = call.getArguments();
  if (!executable || !Node.isStringLiteral(executable)) return false;
  const [program = '', ...inlineArguments] = executable.getLiteralText().trim().split(/\s+/);
  const name = (program.split(/[\\/]/).at(-1) ?? '').toLowerCase().replace(/\.exe$/, '');
  const interpreter = STDIN_PROGRAM_INTERPRETERS.has(name) || /^python(?:\d+(?:\.\d+)?)?$/.test(name);
  if (!interpreter || !inlineArguments.every(readsStdinArgument)) return false;
  if (!argv || argv === optionsArgument || isAbsentLiteral(argv)) return true;
  if (!Node.isArrayLiteralExpression(argv)) return false;
  return argv
    .getElements()
    .every((element) => Node.isStringLiteral(element) && readsStdinArgument(element.getLiteralText()));
}

function readsStdinArgument(argument: string): boolean {
  return argument === '-' || (argument.startsWith('-') && argument !== '-c' && argument !== '-e');
}

function isAbsentLiteral(node: import('ts-morph').Node): boolean {
  return Node.isNullLiteral(node) || (Node.isIdentifier(node) && node.getText() === 'undefined');
}
