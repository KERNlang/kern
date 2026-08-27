import { Node } from 'ts-morph';
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
  category: TaintSink['category'],
  calleeName: string,
  argIndex: number,
  argument?: import('ts-morph').Node,
): boolean {
  if (category === 'nosql') return NOSQL_QUERY_ARG_INDEXES[calleeName]?.has(argIndex) ?? false;
  if (category !== 'command') return true;
  if (argument && (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument))) return false;
  const commandName = calleeName.split('.').at(-1) ?? calleeName;
  return COMMAND_SINK_ARGUMENTS[commandName]?.has(argIndex) ?? true;
}

export function isBenignCommandInputReference(
  category: TaintSink['category'],
  _calleeName: string,
  argIndex: number,
  reference: import('ts-morph').Node,
  argument: import('ts-morph').Node,
): boolean {
  if (category !== 'command') return false;
  if (argIndex === 0 || !Node.isObjectLiteralExpression(argument)) return false;

  let current: import('ts-morph').Node | undefined = reference;
  while (current && current !== argument) {
    const parent: import('ts-morph').Node | undefined = current.getParent();
    if (!parent) return false;
    if (
      (Node.isPropertyAssignment(parent) || Node.isShorthandPropertyAssignment(parent)) &&
      parent.getName() === 'input' &&
      parent.getParent() === argument
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}
