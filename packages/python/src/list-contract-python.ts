/** Python-only emitted helper for the strict `List.index(List, Number)` contract. */

import { KERN_LIST_INDEX_HELPER_PY_NAME } from '@kernlang/core';

const STRICT_TYPE_MESSAGE = 'List.index expects List, Number.';

export const KERN_LIST_INDEX_HELPER_PY = [
  `def ${KERN_LIST_INDEX_HELPER_PY_NAME}(values, index):`,
  `    if not isinstance(values, list) or isinstance(index, bool) or not isinstance(index, (int, float)): raise Exception(${JSON.stringify(STRICT_TYPE_MESSAGE)})`,
  `    if isinstance(index, float) and (index != index or index == float('inf') or index == float('-inf')): raise Exception(${JSON.stringify(STRICT_TYPE_MESSAGE)})`,
  '    if isinstance(index, float):',
  '        if not index.is_integer():',
  '            return _KERN_UNDEFINED',
  '        index = int(index)',
  '    if index < 0 or index >= len(values):',
  '        return _KERN_UNDEFINED',
  '    return values[index]',
].join('\n');
