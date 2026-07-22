/** Shared emitted helpers for the strict `List.index(List, Number)` contract. */

import { KERN_LIST_INDEX_HELPER_TS_NAME } from '../portable-power.js';

const STRICT_TYPE_MESSAGE = 'List.index expects List, Number.';

function listIndexHelperLines(types: boolean): string[] {
  const signature = types
    ? `function ${KERN_LIST_INDEX_HELPER_TS_NAME}<T>(values: readonly T[], index: number): T | undefined {`
    : `function ${KERN_LIST_INDEX_HELPER_TS_NAME}(values, index) {`;
  return [
    signature,
    `  if (!Array.isArray(values) || typeof index !== 'number' || !Number.isFinite(index)) throw new Error(${JSON.stringify(STRICT_TYPE_MESSAGE)});`,
    '  if (!Number.isInteger(index) || index < 0 || index >= values.length || !Object.hasOwn(values, index)) return undefined;',
    '  return values[index];',
    '}',
  ];
}

export function listIndexHelperTS(): string {
  return listIndexHelperLines(true).join('\n');
}

export const KERN_LIST_INDEX_HELPER_JS = listIndexHelperLines(false).join('\n');
