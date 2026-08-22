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
      if (name === 'value' || name === 'cond') {
        violations.push(...callsInExpression(decodeKernValue(raw)));
      }
    }
  }
  return [...new Set(violations)];
}

function hostExecutableCode(source) {
  let result = '';
  let state = 'code';
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (character === '\n') {
        state = 'code';
        result += '\n';
      } else result += ' ';
    } else if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'code';
      } else result += character === '\n' ? '\n' : ' ';
    } else if (state !== 'code') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if ((state === 'single' && character === "'") ||
               (state === 'double' && character === '"') ||
               (state === 'template' && character === '`')) state = 'code';
      result += character === '\n' ? '\n' : ' ';
    } else if (character === '/' && next === '/') {
      result += '  ';
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      result += '  ';
      index += 1;
      state = 'block-comment';
    } else if (character === "'") {
      result += ' ';
      state = 'single';
    } else if (character === '"') {
      result += ' ';
      state = 'double';
    } else if (character === '`') {
      result += ' ';
      state = 'template';
    } else result += character;
  }
  return result;
}

export function scanWorkerSemanticOwnership(source) {
  return [...new Set(callsInExpression(hostExecutableCode(String(source))))];
}

function callArguments(expression, name) {
  const marker = `${name}(`;
  const start = expression.indexOf(marker);
  if (start < 0) return [];
  let depth = 1;
  let quote = null;
  let escaped = false;
  let argument = '';
  const result = [];
  for (let index = start + marker.length; index < expression.length; index += 1) {
    const character = expression[index];
    if (quote !== null) {
      argument += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      argument += character;
    } else if (character === '(') {
      depth += 1;
      argument += character;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        result.push(argument.trim());
        return result;
      }
      argument += character;
    } else if (character === ',' && depth === 1) {
      result.push(argument.trim());
      argument = '';
    } else argument += character;
  }
  return [];
}

export function scanHardcodedRootArguments(source) {
  const violations = [];
  for (const line of kernLines(source)) {
    for (const [name, raw] of attributes(line)) {
      if (name !== 'value') continue;
      const args = callArguments(decodeKernValue(raw), 'classifyf4available');
      for (let index = 0; index < args.length; index += 1) {
        if (/^(?:-?\d+(?:\.\d+)?|true|false|null|".*"|'.*')$/u.test(args[index])) {
          violations.push(`classifyf4available[${index}]=${args[index]}`);
        }
      }
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

export function runA8SourceOwnership(source, workerSource = '') {
  requireExact(scanSemanticOwnership(source), [], 'pristine source ownership violation');
  requireExact(scanWorkerSemanticOwnership(workerSource), [], 'pristine worker ownership violation');
  requireExact(scanShadowClosure(source), [], 'pristine source closure violation');

  const semanticMutant = `${source}\nlet name=a8OwnershipMutant value="parseDocument(source)"`;
  const shadowMutant = `${source}\nuse path="kern.frontend.a8-shadow.1"`;
  requireExact(scanSemanticOwnership(semanticMutant), ['parseDocument'], 'reachable ownership mutant');
  requireExact(scanWorkerSemanticOwnership(`${workerSource}\nparseDocument(source);`), ['parseDocument'],
    'reachable worker ownership mutant');
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
