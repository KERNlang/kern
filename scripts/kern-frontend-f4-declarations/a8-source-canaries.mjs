const FORBIDDEN_CLASSIFIERS = ['parseDocument', 'parseLines', 'bootstrapSemantic', 'classifyHostAst'];
const SHADOW_NAME = /^kern\.frontend\.[A-Za-z0-9_.-]*-shadow\.[A-Za-z0-9_.-]+$/u;

function kernLines(source) {
  return String(source).split(/\r?\n/u).map((line) => {
    let quote = false;
    let escaped = false;
    let end = line.length;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) escaped = false;
      else if (character === '\\' && quote) escaped = true;
      else if (character === '"') quote = !quote;
      else if (character === '#' && !quote) {
        end = index;
        break;
      }
    }
    return line.slice(0, end);
  });
}

function fields(line) {
  const result = [];
  let start = -1;
  let quote = false;
  let escaped = false;
  for (let index = 0; index <= line.length; index += 1) {
    const character = line[index];
    if (start < 0) {
      if (index === line.length || /\s/u.test(character)) continue;
      start = index;
    }
    if (index === line.length || (/\s/u.test(character) && !quote)) {
      result.push(line.slice(start, index));
      start = -1;
      continue;
    }
    if (escaped) escaped = false;
    else if (character === '\\' && quote) escaped = true;
    else if (character === '"') quote = !quote;
  }
  return result;
}

function attributes(line) {
  return fields(line).slice(1).map((field) => {
    const equals = field.indexOf('=');
    return equals < 1 ? null : [field.slice(0, equals), field.slice(equals + 1)];
  }).filter(Boolean);
}

function decodeKernValue(raw) {
  if (raw.length >= 2 && raw[0] === '"' && raw.at(-1) === '"') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1).replace(/\\(["\\])/gu, '$1');
    }
  }
  return raw;
}

function callsInExpression(expression) {
  const calls = [];
  let code = '';
  let quote = null;
  let escaped = false;
  for (const character of expression) {
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      code += ' ';
    } else if (character === '"' || character === "'") {
      quote = character;
      code += ' ';
    } else code += character;
  }
  for (const classifier of FORBIDDEN_CLASSIFIERS) {
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_$])${classifier}\\s*\\(`, 'u');
    if (pattern.test(code)) calls.push(classifier);
  }
  return calls;
}

export function scanSemanticOwnership(source) {
  const violations = [];
  for (const line of kernLines(source)) {
    for (const [name, raw] of attributes(line)) {
      if (name === 'value') violations.push(...callsInExpression(decodeKernValue(raw)));
    }
  }
  return [...new Set(violations)];
}

export function scanShadowClosure(source) {
  const violations = [];
  for (const line of kernLines(source)) {
    const tokens = fields(line);
    const dependencyAttribute = tokens[0] === 'use' ? 'path' : tokens[0] === 'call' ? 'name' : null;
    if (dependencyAttribute === null) continue;
    for (const [name, raw] of attributes(line)) {
      const dependency = decodeKernValue(raw);
      if (name === dependencyAttribute && SHADOW_NAME.test(dependency)) violations.push(dependency);
    }
  }
  return [...new Set(violations)];
}

function requireExact(actual, expected, context) {
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new Error(`${context}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

export function runA8SourceOwnership(source) {
  requireExact(scanSemanticOwnership(source), [], 'pristine source ownership violation');
  requireExact(scanShadowClosure(source), [], 'pristine source closure violation');

  const semanticMutant = `${source}\nlet name=a8OwnershipMutant value="parseDocument(source)"`;
  const shadowMutant = `${source}\nuse path="kern.frontend.a8-shadow.1"`;
  requireExact(scanSemanticOwnership(semanticMutant), ['parseDocument'], 'reachable ownership mutant');
  requireExact(scanShadowClosure(semanticMutant), [], 'paired ownership mutant closure control');
  requireExact(scanSemanticOwnership(shadowMutant), [], 'paired closure mutant ownership control');
  requireExact(scanShadowClosure(shadowMutant), ['kern.frontend.a8-shadow.1'], 'reachable closure mutant');

  return [
    {
      id: 'A8-F2', control: 'passed', sentinel: 'reached', envelope: 'not-applicable',
      killedBy: 'source-ownership-rejection',
    },
    {
      id: 'A8-F3', control: 'passed', sentinel: 'reached', envelope: 'not-applicable',
      killedBy: 'source-closure-rejection',
    },
  ];
}
