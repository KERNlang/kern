import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { encodeKirEvidence } from '../../packages/core/dist/kir-evidence/canonical.js';
import { decodeModuleKir, encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { decodeKirV1, encodeKirV1 } from '../../packages/core/dist/kir-v1/canonical.js';
import { parseDocumentStrict } from '../../packages/core/dist/parser.js';
import { r0KirLimits as limits } from './r0-abi-kir-limits.mjs';


function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytes(value) {
  return Buffer.from(value, 'hex');
}

function property(node, key) {
  const result = node.properties.find((item) => item.key === key)?.value;
  assert.ok(result, `${node.kind} is missing ${key}`);
  return result;
}

function text(value, label) {
  assert.equal(value.tag, 'text', `${label} must be text`);
  return value.value;
}

function boolean(value, label) {
  assert.equal(value.tag, 'bool', `${label} must be boolean`);
  return value.value;
}

function recordField(value, key, label) {
  assert.equal(value.tag, 'record', `${label} must be a canonical record`);
  const result = value.value.find((item) => item.key === key)?.value;
  assert.ok(result, `${label} is missing ${key}`);
  return result;
}

function expressionKind(value, label) {
  return text(recordField(value, 'kind', label), `${label}.kind`);
}

function callMember(value, label) {
  assert.equal(expressionKind(value, label), 'call', `${label} must be a call`);
  const fields = recordField(value, 'fields', label);
  const callee = recordField(fields, 'callee', `${label}.fields`);
  assert.equal(expressionKind(callee, `${label}.callee`), 'member', `${label} must use member syntax`);
  const memberFields = recordField(callee, 'fields', `${label}.callee`);
  return text(recordField(memberFields, 'property', `${label}.callee.fields`), `${label}.callee.property`);
}

function callFirstArgument(value, label) {
  const fields = recordField(value, 'fields', label);
  const args = recordField(fields, 'args', `${label}.fields`);
  assert.equal(args.tag, 'list', `${label}.args must be a list`);
  assert.ok(args.value[0], `${label}.args must contain a composed record`);
  return args.value[0];
}

function recordExpressionKeys(value, label) {
  assert.equal(expressionKind(value, label), 'record', `${label} must be a composed record`);
  const entries = recordField(recordField(value, 'fields', label), 'entries', `${label}.fields`);
  assert.equal(entries.tag, 'record', `${label}.entries must be a canonical record`);
  return entries.value.map((entry) => entry.key);
}

function textLeaves(value) {
  if (value.tag === 'text') return [value.value];
  if (value.tag === 'record') return value.value.flatMap((entry) => textLeaves(entry.value));
  if (value.tag === 'list') return value.value.flatMap(textLeaves);
  return [];
}

function identifier(value, label) {
  assert.equal(expressionKind(value, label), 'identifier', `${label} must be an identifier`);
  return text(recordField(recordField(value, 'fields', label), 'name', `${label}.fields`), `${label}.name`);
}

function sourceFor(entry, operations) {
  const capabilityLines = operations.map((operation, index) =>
    `    capability namespace=r0fixture operation=${operation} name=${index === 0 ? 'reply' : 'replyNext'}`,
  );
  const replyFields =
    operations.length === 0
      ? ''
      : operations.length === 1
        ? ', reply: reply'
        : ', replies: [reply, replyNext]';
  return [
    `fn name=${entry.handlerName} export=true returns=string`,
    '  param name=text type=string',
    '  param name=textList type=string[]',
    '  handler lang=kern',
    '    let name=payload value="Json.parse(text)"',
    ...capabilityLines,
    `    let name=result value="Json.stringify({ labels: textList, payload: payload${replyFields} })"`,
    '    print value="result"',
    '    return value="result"',
    '',
  ].join('\n');
}

function evidenceFor(semanticBytes, moduleId, source) {
  const content = 'Json.parse(text)';
  const startByte = Buffer.byteLength(source.slice(0, source.indexOf(content)), 'utf8');
  const sources = [{ moduleId, source }];
  const evidenceBytes = encodeKirEvidence(
    {
      diagnostics: [
        {
          category: 'validator',
          code: 'r0-json-parse',
          id: 'r0-json-parse-witness',
          message: 'R0 authenticates the Json.parse expression witness.',
          moduleId,
          severity: 'info',
          spanId: 'r0-json-parse-expression',
        },
      ],
      semanticBytes,
      sources,
      spans: [
        {
          content,
          endByte: startByte + Buffer.byteLength(content, 'utf8'),
          id: 'r0-json-parse-expression',
          moduleId,
          nodePath: [0, 2, 0],
          propertyKey: 'value',
          startByte,
        },
      ],
    },
    { limits },
  );
  return { evidenceBytes, sources };
}

/** Constructs the only KIR authority fed to the generator; runtime data stays in the caller. */
export function buildCompileCase({ id, entry, operations }) {
  assert.match(id, /^[a-z0-9-]+$/u, 'compile case id must be portable');
  assert.deepEqual(Object.keys(entry).sort(), ['handlerName', 'moduleId']);
  assert.match(entry.moduleId, /\.kern$/u, 'entry module must be an accepted KIR module id');
  assert.ok(Array.isArray(operations) && operations.length <= 2, 'R0 supports zero, one, or two capabilities');
  const source = sourceFor(entry, operations);
  const semanticBytes = encodeModuleKir(
    [{ id: entry.moduleId, roots: parseDocumentStrict(source).children ?? [] }],
    limits,
  );
  const { evidenceBytes, sources } = evidenceFor(semanticBytes, entry.moduleId, source);
  const kirBytes = encodeKirV1({ semanticBytes, evidenceBytes }, sources, { limits });
  return {
    entry,
    id,
    kirBytesHex: Buffer.from(kirBytes).toString('hex'),
    sourceEvidenceCatalog: sources,
  };
}

/** Independently proves the generated compile input contains the executable R0 subset. */
export function assertExecutableR0Kir(compileCase, operations) {
  const kir = decodeKirV1(bytes(compileCase.kirBytesHex), compileCase.sourceEvidenceCatalog, { limits });
  const semantic = decodeModuleKir(kir.semanticBytes, limits);
  assert.equal(semantic.modules.length, 1, 'R0 KIR must contain one executable module');
  const module = semantic.modules[0];
  assert.equal(module.id, compileCase.entry.moduleId);
  assert.equal(module.roots.length, 1, 'R0 KIR must contain one exported handler');
  const fn = module.roots[0];
  assert.equal(fn.kind, 'fn');
  assert.equal(text(property(fn, 'name'), 'handler name'), compileCase.entry.handlerName);
  assert.equal(boolean(property(fn, 'export'), 'handler export'), true);
  assert.deepEqual(fn.children.map((child) => child.kind), ['param', 'param', 'handler']);
  assert.equal(text(property(fn.children[0], 'name'), 'first parameter'), 'text');
  assert.equal(text(property(fn.children[1], 'name'), 'second parameter'), 'textList');
  assert.deepEqual(property(fn.children[0], 'type'), {
    tag: 'record', value: [{ key: 'kind', value: { tag: 'text', value: 'text' } }],
  });
  assert.deepEqual(property(fn.children[1], 'type'), {
    tag: 'record',
    value: [
      { key: 'element', value: { tag: 'text', value: 'text' } },
      { key: 'kind', value: { tag: 'text', value: 'list' } },
    ],
  });
  const handler = fn.children[2];
  const expectedKinds = ['let', ...operations.map(() => 'capability'), 'let', 'print', 'return'];
  assert.deepEqual(handler.children.map((child) => child.kind), expectedKinds);
  assert.equal(callMember(property(handler.children[0], 'value'), 'Json.parse expression'), 'parse');
  const capabilities = handler.children.filter((child) => child.kind === 'capability');
  assert.deepEqual(capabilities.map((child) => text(property(child, 'operation'), 'capability operation')), operations);
  assert.deepEqual(capabilities.map((child) => text(property(child, 'namespace'), 'capability namespace')), operations.map(() => 'r0fixture'));
  const stringify = property(handler.children.at(-3), 'value');
  assert.equal(callMember(stringify, 'Json.stringify expression'), 'stringify');
  const composedRecord = callFirstArgument(stringify, 'Json.stringify expression');
  assert.deepEqual(
    recordExpressionKeys(composedRecord, 'Json.stringify record'),
    operations.length === 0 ? ['labels', 'payload'] : operations.length === 1 ? ['labels', 'payload', 'reply'] : ['labels', 'payload', 'replies'],
  );
  const bindings = textLeaves(composedRecord);
  if (operations.length > 0) assert.ok(bindings.includes('reply'), 'composed record must bind first capability result');
  if (operations.length > 1) assert.ok(bindings.includes('replyNext'), 'composed record must bind second capability result');
  assert.equal(identifier(property(handler.children.at(-2), 'value'), 'stdout expression'), 'result');
  assert.equal(identifier(property(handler.children.at(-1), 'value'), 'return expression'), 'result');
  return { kirSha256: digest(bytes(compileCase.kirBytesHex)), semanticSha256: digest(kir.semanticBytes) };
}
