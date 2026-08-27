import type { TaintSink } from './taint-types.js';
import { NOSQL_QUERY_ARG_INDEXES } from './taint-types.js';

const COMMAND_SINK_ARGUMENTS: Readonly<Record<string, ReadonlySet<number>>> = {
  exec: new Set([0]),
  execSync: new Set([0]),
  execFile: new Set([0, 1]),
  execFileSync: new Set([0, 1]),
  spawn: new Set([0, 1]),
  spawnSync: new Set([0, 1]),
};

export function acceptsTaintedSinkArgument(
  category: TaintSink['category'],
  calleeName: string,
  argIndex: number,
): boolean {
  if (category === 'nosql') return NOSQL_QUERY_ARG_INDEXES[calleeName]?.has(argIndex) ?? false;
  if (category !== 'command') return true;
  const commandName = calleeName.split('.').at(-1) ?? calleeName;
  return COMMAND_SINK_ARGUMENTS[commandName]?.has(argIndex) ?? true;
}
