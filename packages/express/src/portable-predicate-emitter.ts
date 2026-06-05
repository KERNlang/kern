export function emitExpressPredicateHelpers(
  indent: string,
  absentVar: string,
  getPathVar: string,
  evalPredVar: string,
): string[] {
  const lines: string[] = [];
  lines.push(`${indent}const ${absentVar} = Symbol('absent');`);
  lines.push(`${indent}const ${getPathVar} = (record, path) => {`);
  lines.push(`${indent}  if (record === null || record === undefined) return ${absentVar};`);
  lines.push(`${indent}  const parts = path.split('.');`);
  lines.push(`${indent}  let current = record;`);
  lines.push(`${indent}  for (const part of parts) {`);
  lines.push(`${indent}    if (current === null || current === undefined) return ${absentVar};`);
  lines.push(`${indent}    if (Array.isArray(current)) {`);
  lines.push(`${indent}      if (!/^(0|[1-9]\\d*)$/.test(part)) return ${absentVar};`);
  lines.push(`${indent}      const index = Number(part);`);
  lines.push(`${indent}      if (index >= current.length) return ${absentVar};`);
  lines.push(`${indent}      current = current[index];`);
  lines.push(`${indent}      continue;`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    if (typeof current !== 'object') return ${absentVar};`);
  lines.push(`${indent}    if (!Object.prototype.hasOwnProperty.call(current, part)) return ${absentVar};`);
  lines.push(`${indent}    current = current[part];`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  return current;`);
  lines.push(`${indent}};`);
  const equalVar = `${evalPredVar}Equal`;
  lines.push(`${indent}const ${equalVar} = (actual, expected) => {`);
  lines.push(`${indent}  if (typeof actual === 'boolean' || typeof expected === 'boolean') {`);
  lines.push(
    `${indent}    return typeof actual === 'boolean' && typeof expected === 'boolean' && actual === expected;`,
  );
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (typeof actual === 'number' || typeof expected === 'number') {`);
  lines.push(`${indent}    return typeof actual === 'number' && typeof expected === 'number' && actual === expected;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (typeof actual === 'string' || typeof expected === 'string') {`);
  lines.push(`${indent}    return typeof actual === 'string' && typeof expected === 'string' && actual === expected;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (actual === undefined || expected === undefined) {`);
  lines.push(`${indent}    return actual === undefined && expected === undefined;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  return actual === null && expected === null;`);
  lines.push(`${indent}};`);

  lines.push(`${indent}const ${evalPredVar} = (predicate, record) => {`);
  lines.push(`${indent}  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) {`);
  lines.push(`${indent}    throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (Object.prototype.hasOwnProperty.call(predicate, 'and')) {`);
  lines.push(
    `${indent}    if (Object.keys(predicate).length !== 1 || !Array.isArray(predicate.and) || predicate.and.length === 0) {`,
  );
  lines.push(`${indent}      throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    return predicate.and.every((p) => ${evalPredVar}(p, record));`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (Object.prototype.hasOwnProperty.call(predicate, 'or')) {`);
  lines.push(
    `${indent}    if (Object.keys(predicate).length !== 1 || !Array.isArray(predicate.or) || predicate.or.length === 0) {`,
  );
  lines.push(`${indent}      throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    return predicate.or.some((p) => ${evalPredVar}(p, record));`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (Object.prototype.hasOwnProperty.call(predicate, 'not')) {`);
  lines.push(
    `${indent}    if (Object.keys(predicate).length !== 1 || predicate.not === null || typeof predicate.not !== 'object' || Array.isArray(predicate.not)) {`,
  );
  lines.push(`${indent}      throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    return !${evalPredVar}(predicate.not, record);`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (Object.prototype.hasOwnProperty.call(predicate, 'exists')) {`);
  lines.push(`${indent}    if (Object.keys(predicate).length !== 1 || typeof predicate.exists !== 'string') {`);
  lines.push(`${indent}      throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    return ${getPathVar}(record, predicate.exists) !== ${absentVar};`);
  lines.push(`${indent}  }`);
  lines.push(
    `${indent}  const op = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'startsWith', 'endsWith'].find((candidate) => Object.prototype.hasOwnProperty.call(predicate, candidate));`,
  );
  lines.push(`${indent}  if (!op || Object.keys(predicate).length !== 1) {`);
  lines.push(`${indent}    throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  const pair = predicate[op];`);
  lines.push(`${indent}  if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {`);
  lines.push(`${indent}    throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  const [path, expected] = pair;`);
  lines.push(`${indent}  const actual = ${getPathVar}(record, path);`);
  lines.push(`${indent}  if (op === 'eq') {`);
  lines.push(`${indent}    return actual !== ${absentVar} && ${equalVar}(actual, expected);`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (op === 'neq') {`);
  lines.push(`${indent}    if (actual === ${absentVar}) return expected !== null;`);
  lines.push(`${indent}    return !${equalVar}(actual, expected);`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (op === 'in' || op === 'nin') {`);
  lines.push(`${indent}    if (!Array.isArray(expected) || expected.length === 0) {`);
  lines.push(`${indent}      throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    if (actual === ${absentVar}) return op === 'nin';`);
  lines.push(`${indent}    const matches = expected.some((value) => ${equalVar}(actual, value));`);
  lines.push(`${indent}    return op === 'in' ? matches : !matches;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (op === 'contains') {`);
  lines.push(`${indent}    if (actual === ${absentVar}) return false;`);
  lines.push(
    `${indent}    if (typeof actual === 'string') return typeof expected === 'string' && actual.includes(expected);`,
  );
  lines.push(`${indent}    if (Array.isArray(actual)) return actual.some((value) => ${equalVar}(value, expected));`);
  lines.push(`${indent}    return false;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (op === 'startsWith' || op === 'endsWith') {`);
  lines.push(`${indent}    if (typeof expected !== 'string' || typeof actual !== 'string') return false;`);
  lines.push(`${indent}    return op === 'startsWith' ? actual.startsWith(expected) : actual.endsWith(expected);`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {`);
  lines.push(`${indent}    if (typeof actual !== 'number' || typeof expected !== 'number') return false;`);
  lines.push(`${indent}    if (op === 'gt') return actual > expected;`);
  lines.push(`${indent}    if (op === 'gte') return actual >= expected;`);
  lines.push(`${indent}    if (op === 'lt') return actual < expected;`);
  lines.push(`${indent}    return actual <= expected;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}};`);
  return lines;
}
