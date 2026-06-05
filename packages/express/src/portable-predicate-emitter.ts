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

  lines.push(`${indent}const ${evalPredVar} = (predicate, record) => {`);
  lines.push(`${indent}  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) {`);
  lines.push(`${indent}    throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (Object.prototype.hasOwnProperty.call(predicate, 'and')) {`);
  lines.push(`${indent}    if (Object.keys(predicate).length !== 1 || !Array.isArray(predicate.and)) {`);
  lines.push(`${indent}      throw new Error('invalid KERN filter predicate');`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}    return predicate.and.every((p) => ${evalPredVar}(p, record));`);
  lines.push(`${indent}  }`);
  lines.push(
    `${indent}  const op = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].find((candidate) => Object.prototype.hasOwnProperty.call(predicate, candidate));`,
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
  lines.push(`${indent}    return actual !== ${absentVar} && actual === expected;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}  if (op === 'neq') {`);
  lines.push(`${indent}    if (actual === ${absentVar}) return expected !== null;`);
  lines.push(`${indent}    return actual !== expected;`);
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
