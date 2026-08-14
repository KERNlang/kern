import { encodeInternalRuntimeEnvelope } from '../../packages/core/dist/runtime-envelope/normalize.js';

import { decodeResult, encodeChunk, envelopeForFields, fail, parseTape } from './transport-contract.mjs';

function replaceChunk(fields, chunks) {
  const candidate = [...fields];
  candidate[7] = chunks.map(encodeChunk).join('');
  return candidate;
}

function firstRawOffset(tape) {
  const marker = ',1:a';
  const markerAt = tape.indexOf(marker);
  if (markerAt < 0) fail('mutation fixture first raw marker');
  return markerAt + marker.length - 1;
}

function changedFirstChunk(fields, change) {
  const chunks = structuredClone(parseTape(fields[7]));
  change(chunks[0]);
  return replaceChunk(fields, chunks);
}

function lowLimitSubstitution(fields, runtimeLimits) {
  const encoded = encodeInternalRuntimeEnvelope(envelopeForFields(fields), { ...runtimeLimits, maxBytes: 512 });
  const decoded = JSON.parse(Buffer.from(encoded).toString('utf8'));
  if (
    decoded.outcome !== 'failure' ||
    decoded.diagnostics?.length !== 1 ||
    decoded.diagnostics[0]?.code !== 'encoded-limit'
  ) {
    fail('encoded-limit mutation did not substitute');
  }
  return decoded;
}

export function mutationSuite(run, policy) {
  const { fields } = run.decoded;
  const mutations = new Map();
  mutations.set('constant-output', [...fields.slice(0, 7), '', fields[8]]);
  mutations.set(
    'drop-record',
    changedFirstChunk(fields, (chunk) => {
      chunk.records.splice(0, 1);
    }),
  );
  mutations.set(
    'duplicate-record',
    changedFirstChunk(fields, (chunk) => {
      chunk.records.splice(1, 0, structuredClone(chunk.records[0]));
    }),
  );
  mutations.set(
    'reorder-record',
    changedFirstChunk(fields, (chunk) => {
      [chunk.records[0], chunk.records[1]] = [chunk.records[1], chunk.records[0]];
    }),
  );
  mutations.set(
    'eof-record',
    changedFirstChunk(fields, (chunk) => {
      chunk.records.push({
        className: 'trivia',
        endScalar: run.source.length,
        kind: 'eof',
        ordinal: run.source.length,
        raw: '',
        startScalar: run.source.length,
      });
    }),
  );
  mutations.set(
    'field-permutation',
    changedFirstChunk(fields, (chunk) => {
      const record = chunk.records[0];
      [record.className, record.kind] = [record.kind, record.className];
    }),
  );
  mutations.set(
    'span-shift',
    changedFirstChunk(fields, (chunk) => {
      chunk.records[0].startScalar = 1;
    }),
  );
  mutations.set(
    'zero-width',
    changedFirstChunk(fields, (chunk) => {
      chunk.records[0].endScalar = chunk.records[0].startScalar;
    }),
  );
  const chunks = parseTape(fields[7]);
  const swapped = structuredClone(chunks);
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  mutations.set('reorder-chunk', replaceChunk(fields, swapped));
  const frameMarker = [...fields];
  frameMarker[7] = `x${frameMarker[7].slice(1)}`;
  mutations.set('frame-marker', frameMarker);
  const noncanonical = [...fields];
  noncanonical[7] = noncanonical[7].replace(/^c0,/u, 'c00,');
  mutations.set('noncanonical-digit', noncanonical);
  const rawOffset = firstRawOffset(fields[7]);
  const truncated = [...fields];
  truncated[7] = `${truncated[7].slice(0, rawOffset)}${truncated[7].slice(rawOffset + 1)}`;
  mutations.set('truncated-raw', truncated);
  const injected = [...fields];
  injected[7] = `${injected[7].slice(0, rawOffset)}x${injected[7].slice(rawOffset)}`;
  mutations.set('injected-raw', injected);
  const recordLength = [...fields];
  recordLength[7] = recordLength[7].replace(',1:a', ',2:a');
  mutations.set('record-length', recordLength);
  const chunkLength = [...fields];
  chunkLength[7] = chunkLength[7].replace(/^c0,0,256,([0-9]+):/u, (_, length) => `c0,0,256,${Number(length) + 1}:`);
  mutations.set('chunk-length', chunkLength);
  const chunkSeal = [...fields];
  chunkSeal[7] = chunkSeal[7].replace('s0c1', 's9c1');
  mutations.set('chunk-seal', chunkSeal);
  const sealCount = [...fields];
  sealCount[8] = `eof:${run.source.length}:${run.source.length}:999:closed`;
  mutations.set('seal-count', sealCount);
  mutations.set('source-substitution', fields);
  mutations.set('false-failure-code', [
    fields[0],
    'failure',
    'SOURCE_LIMIT',
    String(run.source.length),
    '0',
    '0',
    '0',
    '',
    'failure',
  ]);
  mutations.set('failure-source-count', [
    fields[0],
    'failure',
    'FORCED_LATE_FAILURE',
    String(run.source.length + 1),
    '0',
    '0',
    '0',
    '',
    'failure',
  ]);
  mutations.set('encoded-limit-substitution', lowLimitSubstitution(fields, policy.runtimeLimits));

  const rejected = [];
  for (const [name, candidate] of mutations) {
    try {
      if (name === 'encoded-limit-substitution') {
        if (candidate.result?.presence !== 'value') fail('encoded result is not the original success');
      } else {
        decodeResult(
          candidate,
          name === 'source-substitution' ? `${run.source}x` : run.source,
          'mutation-suite',
          policy.profileLimits,
          { forceLateFailure: name === 'failure-source-count' },
        );
      }
    } catch {
      rejected.push(name);
    }
  }
  if (rejected.length !== mutations.size) fail('mutation survived');
  return rejected.sort();
}
