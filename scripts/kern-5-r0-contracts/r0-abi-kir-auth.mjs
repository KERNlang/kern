import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { decodeCanonicalValue, encodeCanonicalValue } from '../../packages/core/dist/canonical-value/canonical.js';
import { decodeKirEvidence, encodeKirEvidence } from '../../packages/core/dist/kir-evidence/canonical.js';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { decodeKirV1, encodeKirV1 } from '../../packages/core/dist/kir-v1/canonical.js';
import { r0KirLimits as limits } from './r0-abi-kir-limits.mjs';

const hex = /^(?:[0-9a-f]{2})+$/u;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytesFromHex(value, label) {
  assert.equal(typeof value, 'string', `${label} must be lowercase hexadecimal bytes`);
  assert.match(value, hex, `${label} must be non-empty lowercase hexadecimal bytes`);
  return Buffer.from(value, 'hex');
}

function sourceCatalog(value, label) {
  assert.ok(Array.isArray(value), `${label} must be a source-evidence catalog array`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  const sources = value.map((source, index) => {
    assert.ok(source && typeof source === 'object' && !Array.isArray(source), `${label}[${index}] must be a record`);
    assert.deepEqual(Object.keys(source).sort(), ['moduleId', 'source'], `${label}[${index}] has unexpected fields`);
    assert.equal(typeof source.moduleId, 'string', `${label}[${index}].moduleId must be text`);
    assert.equal(typeof source.source, 'string', `${label}[${index}].source must be text`);
    return { moduleId: source.moduleId, source: source.source };
  });
  assert.equal(new Set(sources.map((source) => source.moduleId)).size, sources.length, `${label} has duplicate module IDs`);
  return sources;
}

function exactBytes(left, right, label) {
  assert.deepEqual(Buffer.from(left), Buffer.from(right), label);
}

/**
 * Authenticates the generator's transport form against the accepted KIR v1
 * codecs. This deliberately has no alternate decoder: a synthetic wire
 * format cannot satisfy the oracle without becoming an accepted KIR v1
 * bundle first.
 */
export function assertGeneratedKirV1(generated, label) {
  assert.ok(generated && typeof generated === 'object', `${label} generated case must be a record`);
  const kirBytes = bytesFromHex(generated.kirBytesHex, `${label}.kirBytesHex`);
  const semanticBytes = bytesFromHex(generated.semanticBytesHex, `${label}.semanticBytesHex`);
  const evidenceBytes = bytesFromHex(generated.evidenceBytesHex, `${label}.evidenceBytesHex`);
  const sources = sourceCatalog(generated.sourceEvidenceCatalog, `${label}.sourceEvidenceCatalog`);

  assert.equal(generated.kirSha256, digest(kirBytes), `${label}.kirSha256 must authenticate exact KIR v1 bytes`);
  assert.equal(
    generated.semanticSha256,
    digest(semanticBytes),
    `${label}.semanticSha256 must authenticate exact structural module bytes`,
  );
  assert.equal(
    generated.evidenceSha256,
    digest(evidenceBytes),
    `${label}.evidenceSha256 must authenticate exact evidence bytes`,
  );

  const kir = decodeKirV1(kirBytes, sources, { limits });
  exactBytes(kir.semanticBytes, semanticBytes, `${label} KIR v1 semantic component differs from exposed bytes`);
  exactBytes(kir.evidenceBytes, evidenceBytes, `${label} KIR v1 evidence component differs from exposed bytes`);
  assert.equal(kir.semanticSha256, generated.semanticSha256, `${label} decoded semantic digest drifted`);
  assert.equal(kir.evidenceSha256, generated.evidenceSha256, `${label} decoded evidence digest drifted`);
  exactBytes(encodeKirV1(kir, sources, { limits }), kirBytes, `${label} KIR v1 bytes do not round-trip`);

  decodeModuleKir(semanticBytes, limits);
  exactBytes(
    encodeCanonicalValue(decodeCanonicalValue(semanticBytes, limits), limits),
    semanticBytes,
    `${label} structural module bytes do not round-trip through the accepted canonical codec`,
  );

  const evidence = decodeKirEvidence(evidenceBytes, semanticBytes, sources, { limits });
  exactBytes(
    encodeKirEvidence(
      { semanticBytes, sources, spans: evidence.spans, diagnostics: evidence.diagnostics },
      { limits },
    ),
    evidenceBytes,
    `${label} diagnostic evidence bytes do not round-trip through the accepted codec`,
  );
  assert.deepEqual(
    evidence.sources.map((source) => source.moduleId),
    sources.map((source) => source.moduleId).sort(),
    `${label} evidence catalog module IDs drifted`,
  );

  return { evidenceSha256: kir.evidenceSha256, kirSha256: digest(kirBytes), semanticSha256: kir.semanticSha256 };
}
