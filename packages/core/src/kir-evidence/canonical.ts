import { createHash } from 'node:crypto';

import { decodeCanonicalValue, encodeCanonicalValue } from '../canonical-value/canonical.js';
import { type CanonicalValue, CanonicalValueDecodeError } from '../canonical-value/types.js';
import { compareCodePoints } from '../canonical-value/validate.js';
import { projectExpressionText, validateExpressionValue } from '../kir-structural/expression.js';
import { decodeModuleKir } from '../kir-structural/module-canonical.js';
import type { ModuleKirArtifact } from '../kir-structural/module-types.js';
import { StructuralKirError, type StructuralKirNode } from '../kir-structural/types.js';
import {
  KIR_EVIDENCE_FORMAT,
  type KirEvidenceArtifact,
  type KirEvidenceCategory,
  type KirEvidenceCodecOptions,
  type KirEvidenceDiagnostic,
  type KirEvidenceDiagnosticInput,
  KirEvidenceError,
  type KirEvidenceInput,
  type KirEvidenceSeverity,
  type KirEvidenceSource,
  type KirEvidenceSpan,
  type KirEvidenceSpanInput,
} from './types.js';

const SEVERITIES = new Set<KirEvidenceSeverity>(['error', 'warning', 'info']);
const CATEGORIES = new Set<KirEvidenceCategory>(['source', 'parser', 'validator', 'codegen', 'migration']);
const PORTABLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function fail(code: ConstructorParameters<typeof KirEvidenceError>[0], path: string, message: string): never {
  throw new KirEvidenceError(code, path, message);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function int(value: number): CanonicalValue {
  return { tag: 'int', value: String(value) };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function nullableText(value: string | null): CanonicalValue {
  return value === null ? { tag: 'null' } : { tag: 'text', value };
}

function sourceValue(source: KirEvidenceSource): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'moduleId', value: { tag: 'text', value: source.moduleId } },
      { key: 'sha256', value: { tag: 'text', value: source.sha256 } },
      { key: 'utf8ByteLength', value: int(source.utf8ByteLength) },
    ],
  };
}

function spanValue(span: KirEvidenceSpan): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'content', value: { tag: 'text', value: span.content } },
      { key: 'contentSha256', value: { tag: 'text', value: span.contentSha256 } },
      { key: 'endByte', value: int(span.endByte) },
      { key: 'id', value: { tag: 'text', value: span.id } },
      { key: 'moduleId', value: { tag: 'text', value: span.moduleId } },
      { key: 'nodePath', value: { tag: 'list', value: span.nodePath.map(int) } },
      { key: 'propertyKey', value: nullableText(span.propertyKey) },
      { key: 'startByte', value: int(span.startByte) },
    ],
  };
}

function diagnosticValue(diagnostic: KirEvidenceDiagnostic): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'category', value: { tag: 'text', value: diagnostic.category } },
      { key: 'code', value: { tag: 'text', value: diagnostic.code } },
      { key: 'id', value: { tag: 'text', value: diagnostic.id } },
      { key: 'message', value: { tag: 'text', value: diagnostic.message } },
      { key: 'messageSha256', value: { tag: 'text', value: diagnostic.messageSha256 } },
      { key: 'moduleId', value: { tag: 'text', value: diagnostic.moduleId } },
      { key: 'severity', value: { tag: 'text', value: diagnostic.severity } },
      { key: 'spanId', value: { tag: 'text', value: diagnostic.spanId } },
    ],
  };
}

function artifactValue(artifact: KirEvidenceArtifact): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'diagnostics', value: { tag: 'list', value: artifact.diagnostics.map(diagnosticValue) } },
      { key: 'format', value: { tag: 'text', value: artifact.format } },
      { key: 'proofLabel', value: { tag: 'text', value: artifact.proofLabel } },
      {
        key: 'semantic',
        value: {
          tag: 'record',
          value: [
            { key: 'format', value: { tag: 'text', value: artifact.semantic.format } },
            { key: 'sha256', value: { tag: 'text', value: artifact.semantic.sha256 } },
          ],
        },
      },
      { key: 'sources', value: { tag: 'list', value: artifact.sources.map(sourceValue) } },
      { key: 'spans', value: { tag: 'list', value: artifact.spans.map(spanValue) } },
    ],
  };
}

function exact(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  if (
    value.tag !== 'record' ||
    value.value.length !== keys.length ||
    value.value.some((entry, index) => entry.key !== keys[index])
  ) {
    fail('invalid-evidence-artifact', path, `expected fields ${keys.join(',')}`);
  }
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function field(record: Map<string, CanonicalValue>, key: string): CanonicalValue {
  return record.get(key) as CanonicalValue;
}

function text(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail('invalid-evidence-artifact', path, 'expected text');
  return value.value;
}

function safeInt(value: CanonicalValue, path: string): number {
  if (value.tag !== 'int' || !/^(?:0|[1-9][0-9]*)$/u.test(value.value)) {
    fail('invalid-evidence-artifact', path, 'expected a non-negative canonical integer');
  }
  const result = Number(value.value);
  if (!Number.isSafeInteger(result)) fail('invalid-evidence-artifact', path, 'integer is outside safe range');
  return result;
}

function list(value: CanonicalValue, path: string): readonly CanonicalValue[] {
  if (value.tag !== 'list') fail('invalid-evidence-artifact', path, 'expected list');
  return value.value;
}

function parseSource(value: CanonicalValue, path: string): KirEvidenceSource {
  const record = exact(value, ['moduleId', 'sha256', 'utf8ByteLength'], path);
  return {
    moduleId: text(field(record, 'moduleId'), `${path}.moduleId`),
    sha256: text(field(record, 'sha256'), `${path}.sha256`),
    utf8ByteLength: safeInt(field(record, 'utf8ByteLength'), `${path}.utf8ByteLength`),
  };
}

function parseSpan(value: CanonicalValue, path: string): KirEvidenceSpan {
  const record = exact(
    value,
    ['content', 'contentSha256', 'endByte', 'id', 'moduleId', 'nodePath', 'propertyKey', 'startByte'],
    path,
  );
  const property = field(record, 'propertyKey');
  return {
    content: text(field(record, 'content'), `${path}.content`),
    contentSha256: text(field(record, 'contentSha256'), `${path}.contentSha256`),
    endByte: safeInt(field(record, 'endByte'), `${path}.endByte`),
    id: text(field(record, 'id'), `${path}.id`),
    moduleId: text(field(record, 'moduleId'), `${path}.moduleId`),
    nodePath: list(field(record, 'nodePath'), `${path}.nodePath`).map((item, index) =>
      safeInt(item, `${path}.nodePath[${index}]`),
    ),
    propertyKey: property.tag === 'null' ? null : text(property, `${path}.propertyKey`),
    startByte: safeInt(field(record, 'startByte'), `${path}.startByte`),
  };
}

function parseDiagnostic(value: CanonicalValue, path: string): KirEvidenceDiagnostic {
  const record = exact(
    value,
    ['category', 'code', 'id', 'message', 'messageSha256', 'moduleId', 'severity', 'spanId'],
    path,
  );
  return {
    category: text(field(record, 'category'), `${path}.category`) as KirEvidenceCategory,
    code: text(field(record, 'code'), `${path}.code`),
    id: text(field(record, 'id'), `${path}.id`),
    message: text(field(record, 'message'), `${path}.message`),
    messageSha256: text(field(record, 'messageSha256'), `${path}.messageSha256`),
    moduleId: text(field(record, 'moduleId'), `${path}.moduleId`),
    severity: text(field(record, 'severity'), `${path}.severity`) as KirEvidenceSeverity,
    spanId: text(field(record, 'spanId'), `${path}.spanId`),
  };
}

function parseArtifact(value: CanonicalValue): KirEvidenceArtifact {
  const record = exact(value, ['diagnostics', 'format', 'proofLabel', 'semantic', 'sources', 'spans'], '$');
  const format = text(field(record, 'format'), '$.format');
  if (format !== KIR_EVIDENCE_FORMAT)
    fail('unsupported-evidence-version', '$.format', `expected ${KIR_EVIDENCE_FORMAT}`);
  if (text(field(record, 'proofLabel'), '$.proofLabel') !== 'ALPHA-NO-GO') {
    fail('invalid-evidence-artifact', '$.proofLabel', 'must remain ALPHA-NO-GO');
  }
  const semantic = exact(field(record, 'semantic'), ['format', 'sha256'], '$.semantic');
  return {
    diagnostics: list(field(record, 'diagnostics'), '$.diagnostics').map((item, index) =>
      parseDiagnostic(item, `$.diagnostics[${index}]`),
    ),
    format: KIR_EVIDENCE_FORMAT,
    proofLabel: 'ALPHA-NO-GO',
    semantic: {
      format: text(field(semantic, 'format'), '$.semantic.format'),
      sha256: text(field(semantic, 'sha256'), '$.semantic.sha256'),
    },
    sources: list(field(record, 'sources'), '$.sources').map((item, index) => parseSource(item, `$.sources[${index}]`)),
    spans: list(field(record, 'spans'), '$.spans').map((item, index) => parseSpan(item, `$.spans[${index}]`)),
  };
}

function stableId(value: string, path: string): void {
  if (!PORTABLE_ID.test(value)) fail('invalid-evidence-artifact', path, 'expected portable lowercase identifier');
}

function digest(value: string, path: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) fail('invalid-evidence-artifact', path, 'expected lowercase SHA-256');
}

function ordered<T>(rows: readonly T[], id: (row: T) => string, path: string): void {
  rows.forEach((row, index) => {
    if (index > 0 && compareCodePoints(id(rows[index - 1] as T), id(row)) >= 0) {
      fail('invalid-evidence-artifact', `${path}[${index}]`, 'rows must be unique and strictly code-point sorted');
    }
  });
}

function resolveNode(artifact: ModuleKirArtifact, span: KirEvidenceSpan, path: string): StructuralKirNode {
  const module = artifact.modules.find((item) => item.id === span.moduleId);
  if (!module || span.nodePath.length === 0) fail('dangling-span', path, 'module or root path is missing');
  let node = module.roots[span.nodePath[0] as number];
  if (!node) fail('dangling-span', path, 'root index is missing');
  for (const childIndex of span.nodePath.slice(1)) {
    const child = node.children?.[childIndex];
    if (!child) fail('dangling-span', path, 'child index is missing');
    node = child;
  }
  return node;
}

function validateArtifact(
  artifact: KirEvidenceArtifact,
  semantic: ModuleKirArtifact,
  semanticBytes: Uint8Array,
  sourceInputs: readonly KirEvidenceInput['sources'][number][],
  options: KirEvidenceCodecOptions,
): void {
  digest(artifact.semantic.sha256, '$.semantic.sha256');
  if (artifact.semantic.format !== semantic.format || artifact.semantic.sha256 !== sha256(semanticBytes)) {
    fail('semantic-digest-mismatch', '$.semantic', 'semantic artifact binding does not match supplied bytes');
  }
  const suppliedSourceIds = [...sourceInputs.map((source) => source.moduleId)].sort(compareCodePoints);
  if (
    suppliedSourceIds.length !== semantic.modules.length ||
    suppliedSourceIds.some((moduleId, index) => moduleId !== semantic.modules[index]?.id)
  ) {
    fail('source-binding-mismatch', '$.sources', 'supplied source modules must be unique and exact');
  }
  ordered(artifact.sources, (row) => row.moduleId, '$.sources');
  if (
    artifact.sources.length !== semantic.modules.length ||
    artifact.sources.some((row, index) => row.moduleId !== semantic.modules[index]?.id)
  ) {
    fail('source-binding-mismatch', '$.sources', 'source modules must exactly match semantic modules');
  }
  const sourceById = new Map(artifact.sources.map((source) => [source.moduleId, source]));
  const sourceTextById = new Map(sourceInputs.map((source) => [source.moduleId, source.source]));
  artifact.sources.forEach((source, index) => {
    digest(source.sha256, `$.sources[${index}].sha256`);
    const sourceText = sourceTextById.get(source.moduleId);
    const bytes = sourceText === undefined ? undefined : new TextEncoder().encode(sourceText);
    if (!bytes || bytes.length !== source.utf8ByteLength || sha256(bytes) !== source.sha256) {
      fail('source-binding-mismatch', `$.sources[${index}]`, 'source bytes do not match their binding');
    }
  });

  if (artifact.spans.length === 0) fail('invalid-span', '$.spans', 'at least one span is required');
  ordered(artifact.spans, (row) => row.id, '$.spans');
  let expressionSpans = 0;
  const spanById = new Map<string, KirEvidenceSpan>();
  artifact.spans.forEach((span, index) => {
    const path = `$.spans[${index}]`;
    stableId(span.id, `${path}.id`);
    digest(span.contentSha256, `${path}.contentSha256`);
    if (
      !Number.isSafeInteger(span.startByte) ||
      !Number.isSafeInteger(span.endByte) ||
      span.startByte < 0 ||
      span.endByte < 0 ||
      span.nodePath.some((segment) => !Number.isSafeInteger(segment) || segment < 0)
    ) {
      fail('invalid-span', path, 'span offsets and node path segments must be non-negative safe integers');
    }
    const source = sourceById.get(span.moduleId);
    if (!source || span.startByte >= span.endByte || span.endByte > source.utf8ByteLength) {
      fail('invalid-span', path, 'span must be a non-empty in-bounds UTF-8 byte range');
    }
    const sourceText = sourceTextById.get(span.moduleId) as string;
    const actual = new TextEncoder().encode(sourceText).slice(span.startByte, span.endByte);
    const expected = new TextEncoder().encode(span.content);
    if (
      span.content.length === 0 ||
      sha256(expected) !== span.contentSha256 ||
      actual.length !== expected.length ||
      !actual.every((byte, index) => byte === expected[index])
    ) {
      fail('invalid-span', `${path}.content`, 'span content does not match the exact UTF-8 byte range');
    }
    const node = resolveNode(semantic, span, path);
    if (span.propertyKey !== null) {
      const property = node.properties?.find((entry) => entry.key === span.propertyKey);
      if (!property) fail('dangling-span', `${path}.propertyKey`, 'expression property is missing');
      try {
        validateExpressionValue(property.value, `${path}.propertyKey`);
        const projected = projectExpressionText(span.content, `${path}.content`);
        if (
          !sameBytes(
            encodeCanonicalValue(projected, options.limits),
            encodeCanonicalValue(property.value, options.limits),
          )
        ) {
          fail('dangling-span', `${path}.content`, 'source text does not match the bound expression property');
        }
      } catch (error) {
        if (error instanceof StructuralKirError)
          fail('dangling-span', `${path}.propertyKey`, 'property is not an expression');
        throw error;
      }
      expressionSpans += 1;
    }
    spanById.set(span.id, span);
  });
  if (expressionSpans === 0) fail('invalid-span', '$.spans', 'at least one expression span is required');

  if (artifact.diagnostics.length === 0)
    fail('invalid-diagnostic', '$.diagnostics', 'at least one diagnostic is required');
  ordered(artifact.diagnostics, (row) => row.id, '$.diagnostics');
  artifact.diagnostics.forEach((diagnostic, index) => {
    const path = `$.diagnostics[${index}]`;
    stableId(diagnostic.id, `${path}.id`);
    stableId(diagnostic.code, `${path}.code`);
    if (!SEVERITIES.has(diagnostic.severity) || !CATEGORIES.has(diagnostic.category)) {
      fail('invalid-diagnostic', path, 'severity or category is outside the closed catalog');
    }
    const span = spanById.get(diagnostic.spanId);
    if (!span || span.moduleId !== diagnostic.moduleId)
      fail('invalid-diagnostic', path, 'diagnostic span binding is missing');
    if (diagnostic.message.length === 0 || diagnostic.messageSha256 !== sha256(diagnostic.message)) {
      fail('invalid-diagnostic', `${path}.message`, 'message must be non-empty and match its SHA-256');
    }
  });
}

function buildArtifact(input: KirEvidenceInput, semantic: ModuleKirArtifact): KirEvidenceArtifact {
  const sources = input.sources
    .map((source) => {
      const bytes = new TextEncoder().encode(source.source);
      return { moduleId: source.moduleId, sha256: sha256(bytes), utf8ByteLength: bytes.length };
    })
    .sort((left, right) => compareCodePoints(left.moduleId, right.moduleId));
  const spans = input.spans
    .map((span: KirEvidenceSpanInput) => ({
      ...span,
      contentSha256: sha256(span.content),
      nodePath: [...span.nodePath],
    }))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const diagnostics = input.diagnostics
    .map((diagnostic: KirEvidenceDiagnosticInput) => ({
      ...diagnostic,
      messageSha256: sha256(diagnostic.message),
    }))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  return {
    diagnostics,
    format: KIR_EVIDENCE_FORMAT,
    proofLabel: 'ALPHA-NO-GO',
    semantic: { format: semantic.format, sha256: sha256(input.semanticBytes) },
    sources,
    spans,
  };
}

export function encodeKirEvidence(input: KirEvidenceInput, options: KirEvidenceCodecOptions): Uint8Array {
  try {
    const semantic = decodeModuleKir(input.semanticBytes, options.limits);
    const artifact = buildArtifact(input, semantic);
    validateArtifact(artifact, semantic, input.semanticBytes, input.sources, options);
    return encodeCanonicalValue(artifactValue(artifact), options.limits);
  } catch (error) {
    if (
      error instanceof KirEvidenceError ||
      error instanceof CanonicalValueDecodeError ||
      error instanceof StructuralKirError
    )
      throw error;
    fail('invalid-evidence-artifact', '$', 'evidence input cannot be encoded');
  }
}

export function decodeKirEvidence(
  input: Uint8Array,
  semanticBytes: Uint8Array,
  sources: readonly KirEvidenceInput['sources'][number][],
  options: KirEvidenceCodecOptions,
): KirEvidenceArtifact {
  try {
    const artifact = parseArtifact(decodeCanonicalValue(input, options.limits));
    validateArtifact(artifact, decodeModuleKir(semanticBytes, options.limits), semanticBytes, sources, options);
    return artifact;
  } catch (error) {
    if (
      error instanceof KirEvidenceError ||
      error instanceof CanonicalValueDecodeError ||
      error instanceof StructuralKirError
    )
      throw error;
    fail('invalid-evidence-artifact', '$', 'evidence artifact cannot be decoded');
  }
}
