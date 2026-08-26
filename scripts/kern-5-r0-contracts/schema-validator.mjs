import { isDeepStrictEqual } from 'node:util';

function typeMatches(expected, value) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isSafeInteger(value);
  return typeof value === expected;
}

function isPortableInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value);
  return typeof value === 'string' && /^-?(?:0|[1-9][0-9]*)$/u.test(value) && Number.isSafeInteger(Number(value));
}

function describe(path, message) {
  return `${path}: ${message}`;
}

function validate(schema, value, path) {
  const errors = [];
  if (schema.const !== undefined && !isDeepStrictEqual(value, schema.const)) errors.push(describe(path, `must equal ${JSON.stringify(schema.const)}`));
  if (schema.enum && !schema.enum.includes(value)) errors.push(describe(path, 'is not an allowed value'));
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) return [describe(path, `must be ${types.join(' or ')}`)];
  }
  if (schema.pattern && (typeof value !== 'string' || !new RegExp(schema.pattern, 'u').test(value))) errors.push(describe(path, 'does not match its required pattern'));
  if (schema.portableInteger === true && !isPortableInteger(value)) errors.push(describe(path, 'must be a portable safe integer'));
  if (schema.minLength !== undefined && (typeof value !== 'string' || value.length < schema.minLength)) errors.push(describe(path, `must have at least ${schema.minLength} characters`));
  if (schema.minimum !== undefined && value !== null && (!Number.isSafeInteger(value) || value < schema.minimum)) errors.push(describe(path, `must be at least ${schema.minimum}`));
  if (schema.maximum !== undefined && value !== null && (!Number.isSafeInteger(value) || value > schema.maximum)) errors.push(describe(path, `must be at most ${schema.maximum}`));
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => validate(candidate, value, path).length === 0);
    if (matches.length !== 1) errors.push(describe(path, 'must match exactly one allowed shape'));
    return errors;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(describe(path, `must have at least ${schema.minItems} items`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(describe(path, `must have at most ${schema.maxItems} items`));
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${path}[${index}]`)));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(describe(path, `is missing ${key}`));
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) errors.push(describe(path, `has unexpected ${key}`));
    }
    for (const [key, child] of Object.entries(properties)) if (key in value) errors.push(...validate(child, value[key], `${path}.${key}`));
  }
  return errors;
}

export function validateClosedSchema(schema, value) {
  return validate(schema, value, '$');
}

export function assertClosedSchema(schema, value, label) {
  const errors = validateClosedSchema(schema, value);
  if (errors.length > 0) throw new Error(`${label} violates ${schema.$id ?? 'R0 schema'}: ${errors.join('; ')}`);
}
