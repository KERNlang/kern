import { encodeChunk, parseTape } from '../kern-frontend-f1/transport-contract.mjs';

import { decodeScan } from './decoder.mjs';

function withChunks(fields, chunks) {
  const candidate = [...fields];
  candidate[7] = chunks.map(encodeChunk).join('');
  return candidate;
}

function changed(fields, change) {
  const chunks = structuredClone(parseTape(fields[7]));
  change(chunks);
  return withChunks(fields, chunks);
}

function reindexAndSeal(fields, chunks) {
  let ordinal = 0;
  for (const chunk of chunks) {
    chunk.firstRecord = ordinal;
    chunk.count = chunk.records.length;
    for (const record of chunk.records) {
      record.ordinal = ordinal;
      ordinal += 1;
    }
  }
  const candidate = withChunks(fields, chunks);
  candidate[4] = String(ordinal);
  candidate[6] = String(Math.max(chunks.length, ...chunks.map((chunk) => chunk.records.length)));
  candidate[8] = `eof:${candidate[3]}:${ordinal}:${chunks.length}:closed`;
  return candidate;
}

function mergeRecordIntoPrevious(fields, predicate, label) {
  const chunks = structuredClone(parseTape(fields[7]));
  let merged = false;
  for (const chunk of chunks) {
    for (let recordIndex = 1; recordIndex < chunk.records.length; recordIndex += 1) {
      if (!predicate(chunk.records[recordIndex])) continue;
      const previous = chunk.records[recordIndex - 1];
      const record = chunk.records[recordIndex];
      previous.endScalar = record.endScalar;
      previous.raw += record.raw;
      chunk.records.splice(recordIndex, 1);
      merged = true;
      break;
    }
    if (merged) break;
  }
  if (!merged) throw new Error(`F1 scan mutation requires a mergeable ${label}`);
  return reindexAndSeal(fields, chunks);
}

function injectIdentifierInsideQuote(fields) {
  const chunks = structuredClone(parseTape(fields[7]));
  for (const chunk of chunks) {
    const quotedIndex = chunk.records.findIndex((record) => record.raw === '"x"');
    if (quotedIndex >= 0) {
      const quoted = chunk.records[quotedIndex];
      chunk.records.splice(
        quotedIndex,
        1,
        { ...quoted, endScalar: quoted.startScalar + 1, kind: '41', raw: '"' },
        {
          ...quoted,
          endScalar: quoted.startScalar + 2,
          kind: '0',
          raw: 'x',
          startScalar: quoted.startScalar + 1,
        },
        { ...quoted, kind: '46', raw: '"', startScalar: quoted.startScalar + 2 },
      );
      return reindexAndSeal(fields, chunks);
    }
  }
  throw new Error('F1 scan mutation requires a quoted x');
}

function splitCompositeWithoutBoundary(fields, raw, kindId, openerScalars) {
  const chunks = structuredClone(parseTape(fields[7]));
  for (const chunk of chunks) {
    const recordIndex = chunk.records.findIndex((record) => record.raw === raw);
    if (recordIndex >= 0) {
      const record = chunk.records[recordIndex];
      const points = Array.from(raw);
      chunk.records.splice(
        recordIndex,
        1,
        {
          ...record,
          endScalar: record.startScalar + openerScalars,
          kind: String(kindId * 8 + 1),
          raw: points.slice(0, openerScalars).join(''),
        },
        {
          ...record,
          kind: String(kindId * 8 + 6),
          raw: points.slice(openerScalars).join(''),
          startScalar: record.startScalar + openerScalars,
        },
      );
      return reindexAndSeal(fields, chunks);
    }
  }
  throw new Error(`F1 scan mutation requires ${raw}`);
}

function splitCrlfRecord(fields) {
  const chunks = structuredClone(parseTape(fields[7]));
  for (const chunk of chunks) {
    const recordIndex = chunk.records.findIndex((record) => record.raw === '\r\n');
    if (recordIndex >= 0) {
      const record = chunk.records[recordIndex];
      chunk.records.splice(
        recordIndex,
        1,
        { ...record, className: 'token', endScalar: record.startScalar + 1, kind: '72', raw: '\r' },
        { ...record, raw: '\n', startScalar: record.startScalar + 1 },
      );
      return reindexAndSeal(fields, chunks);
    }
  }
  throw new Error('F1 scan mutation requires CRLF');
}

function splitInlineFenceBody(fields) {
  const chunks = structuredClone(parseTape(fields[7]));
  for (const chunk of chunks) {
    const recordIndex = chunk.records.findIndex((record) => record.raw === 'a>>b');
    if (recordIndex >= 0) {
      const record = chunk.records[recordIndex];
      chunk.records.splice(
        recordIndex,
        1,
        { ...record, endScalar: record.startScalar + 1, raw: 'a' },
        { ...record, raw: '>>b', startScalar: record.startScalar + 1 },
      );
      return reindexAndSeal(fields, chunks);
    }
  }
  throw new Error('F1 scan mutation requires inline double-chevron body');
}

export function rejectedMutations(fields, source, policy) {
  const mutations = new Map([
    ['constant-output', [...fields.slice(0, 7), '', fields[8]]],
    ['drop-record', changed(fields, (chunks) => chunks[0].records.splice(0, 1))],
    ['duplicate-record', changed(fields, (chunks) => chunks[0].records.splice(1, 0, structuredClone(chunks[0].records[0])))],
    ['reorder-record', changed(fields, (chunks) => {
      [chunks[0].records[0], chunks[0].records[1]] = [chunks[0].records[1], chunks[0].records[0]];
    })],
    ['class-drift', changed(fields, (chunks) => {
      const token = chunks.flatMap((chunk) => chunk.records).find((record) => record.className === 'token');
      token.className = 'trivia';
    })],
    ['kind-drift', changed(fields, (chunks) => { chunks[0].records[0].kind = '999'; })],
    ['same-class-kind-drift', changed(fields, (chunks) => {
      const identifier = chunks.flatMap((chunk) => chunk.records).find((record) => record.raw === 'text');
      identifier.kind = '8';
    })],
    ['intra-quote-record', injectIdentifierInsideQuote(fields)],
    ['split-quote-without-boundary', splitCompositeWithoutBoundary(fields, '"x"', 5, 1)],
    ['split-expression-without-boundary', splitCompositeWithoutBoundary(fields, '{{x}}', 6, 2)],
    ['split-crlf-newline', splitCrlfRecord(fields)],
    ['split-inline-fence-body', splitInlineFenceBody(fields)],
    ['comment-to-slash', changed(fields, (chunks) => {
      const comment = chunks.flatMap((chunk) => chunk.records).find((record) => record.raw === '//tail');
      comment.className = 'token';
      comment.kind = '24';
    })],
    ['base-fence-body', changed(fields, (chunks) => {
      const comment = chunks.flatMap((chunk) => chunk.records).find((record) => record.raw === '//tail');
      comment.kind = '116';
    })],
    ['fence-closer-to-body', changed(fields, (chunks) => {
      const records = chunks.flatMap((chunk) => chunk.records);
      const closerIndex = records.findIndex(
        (record, index) => record.raw === '>>>' && records[index - 1]?.raw === '\n' && records[index - 2]?.raw === '<<<',
      );
      records[closerIndex].kind = '116';
    })],
    ['non-line-start-fence-closer', changed(fields, (chunks) => {
      const records = chunks.flatMap((chunk) => chunk.records);
      const bodyIndex = records.findIndex(
        (record, index) => record.raw === '>>>' && record.kind === '116' && records[index - 1]?.raw === '\r',
      );
      records[bodyIndex].kind = '106';
    })],
    ['flag-drift', changed(fields, (chunks) => { chunks[0].records[0].kind = '1'; })],
    ['span-drift', changed(fields, (chunks) => { chunks[0].records[0].startScalar = 1; })],
    ['swallowed-newline', changed(fields, (chunks) => {
      const record = chunks.flatMap((chunk) => chunk.records).find((entry) => entry.raw === '\n');
      record.raw = 'x';
    })],
    ['newline-in-non-newline-record', mergeRecordIntoPrevious(
      fields,
      (record) => record.raw === '\n' || record.raw === '\r\n',
      'newline',
    )],
    ['lone-cr-in-non-unknown-record', mergeRecordIntoPrevious(
      fields,
      (record) => record.raw === '\r',
      'lone CR',
    )],
    ['marker-drift', changed(fields, (chunks) => {
      const marker = chunks.flatMap((chunk) => chunk.records).find((entry) => entry.kind === '105');
      marker.kind = '106';
    })],
    ['max-list-underreport', [...fields.slice(0, 6), '0', ...fields.slice(7)]],
    ['partial-failure', [fields[0], 'failure', 'C12:SOURCE_LIMITS1:0E1:0', fields[3], fields[4], fields[5], fields[6], fields[7], 'failure']],
    ['noncanonical-count', [fields[0], fields[1], fields[2], fields[3], `0${fields[4]}`, fields[5], fields[6], fields[7], fields[8]]],
  ]);
  const rejected = [];
  for (const [name, candidate] of mutations) {
    try {
      decodeScan(candidate, source, policy);
    } catch {
      rejected.push(name);
    }
  }
  if (rejected.length !== mutations.size) {
    const survivors = [...mutations.keys()].filter((name) => !rejected.includes(name));
    throw new Error(`F1 scan mutation survived: ${survivors.join(', ')}`);
  }
  return rejected.sort();
}

export function rejectedFabricatedReceipts(policy) {
  const rejected = [];
  const reject = (fields, source, name, options = {}) => {
    assertRejected(fields, source, policy, name, options);
    rejected.push(name);
  };
  const styleSource = '{{}';
  const styleChunk = {
    firstRecord: 0,
    ordinal: 0,
    records: [{ className: 'token', endScalar: 3, kind: '59', ordinal: 0, raw: styleSource, startScalar: 0 }],
  };
  const styleFields = [
    policy.resultFormat,
    'scanned',
    '',
    '3',
    '1',
    '1',
    '1',
    encodeChunk(styleChunk),
    'eof:3:1:1:closed',
  ];
  reject(styleFields, styleSource, 'expression-to-style');
  const wideSource = '@'.repeat(257);
  const wideRecords = Array.from({ length: 257 }, (_, ordinal) => ({
    className: 'token',
    endScalar: ordinal + 1,
    kind: '72',
    ordinal,
    raw: '@',
    startScalar: ordinal,
  }));
  const wideChunk = { firstRecord: 0, ordinal: 0, records: wideRecords };
  const wideFields = [
    policy.resultFormat, 'scanned', '', '257', '257', '1', '256', encodeChunk(wideChunk), 'eof:257:257:1:closed',
  ];
  reject(wideFields, wideSource, 'records-per-chunk-overflow');
  const manyChunks = wideRecords.map((record, ordinal) => ({ firstRecord: ordinal, ordinal, records: [record] }));
  const manyChunkFields = [
    policy.resultFormat,
    'scanned',
    '',
    '257',
    '257',
    '257',
    '1',
    manyChunks.map(encodeChunk).join(''),
    'eof:257:257:257:closed',
  ];
  reject(manyChunkFields, wideSource, 'chunk-count-overflow');
  const impossibleLimit = [
    policy.resultFormat, 'failure', 'C12:SOURCE_LIMITS1:0E3:999', '1', '0', '0', '0', '', 'failure',
  ];
  reject(impossibleLimit, 'x', 'impossible-source-limit');
  const forcedWithoutOption = [
    policy.resultFormat, 'failure', 'C19:FORCED_LATE_FAILURES1:1E1:1', '1', '0', '0', '0', '', 'failure',
  ];
  reject(forcedWithoutOption, 'x', 'ungated-forced-late-failure');
  const illFormedSource = '\ud800';
  const illFormedChunk = {
    firstRecord: 0,
    ordinal: 0,
    records: [{ className: 'token', endScalar: 1, kind: '72', ordinal: 0, raw: illFormedSource, startScalar: 0 }],
  };
  const illFormedSuccess = [
    policy.resultFormat, 'scanned', '', '1', '1', '1', '1', encodeChunk(illFormedChunk), 'eof:1:1:1:closed',
  ];
  reject(illFormedSuccess, illFormedSource, 'ill-formed-success');
  const overCapSource = 'a'.repeat(policy.profileLimits.maxSourceScalars + 1);
  const overCapChunk = {
    firstRecord: 0,
    ordinal: 0,
    records: [{ className: 'token', endScalar: overCapSource.length, kind: '0', ordinal: 0, raw: overCapSource, startScalar: 0 }],
  };
  const overCapSuccess = [
    policy.resultFormat,
    'scanned',
    '',
    String(overCapSource.length),
    '1',
    '1',
    '1',
    encodeChunk(overCapChunk),
    `eof:${overCapSource.length}:1:1:closed`,
  ];
  reject(overCapSuccess, overCapSource, 'over-cap-success');
  const repackedSource = '@@@';
  const repackedRecords = Array.from({ length: 3 }, (_, ordinal) => ({
    className: 'token', endScalar: ordinal + 1, kind: '72', ordinal, raw: '@', startScalar: ordinal,
  }));
  const repackedChunks = repackedRecords.map((record, ordinal) => ({ firstRecord: ordinal, ordinal, records: [record] }));
  const repackedFields = [
    policy.resultFormat, 'scanned', '', '3', '3', '3', '3', repackedChunks.map(encodeChunk).join(''), 'eof:3:3:3:closed',
  ];
  reject(repackedFields, repackedSource, 'noncanonical-chunk-packing');
  const closedStringFailure = [
    policy.resultFormat, 'failure', 'C15:UNCLOSED_STRINGS1:0E1:1', '3', '0', '0', '0', '', 'failure',
  ];
  reject(closedStringFailure, '"x"', 'closed-string-failure');
  const impossibleTransport = [
    policy.resultFormat, 'failure', 'C15:TRANSPORT_LIMITS1:0E1:0', '1', '0', '0', '0', '', 'failure',
  ];
  reject(impossibleTransport, 'x', 'impossible-transport-failure');
  const nestedExpressionFailure = [
    policy.resultFormat, 'failure', 'C13:UNCLOSED_EXPRS1:1E1:3', '3', '0', '0', '0', '', 'failure',
  ];
  reject(nestedExpressionFailure, '"{{', 'inner-expression-failure-precedence');
  const forcedBeforeLexical = [
    policy.resultFormat, 'failure', 'C19:FORCED_LATE_FAILURES1:1E1:1', '1', '0', '0', '0', '', 'failure',
  ];
  reject(
    forcedBeforeLexical,
    '"',
    'forced-before-lexical-failure',
    { allowForcedLateFailure: true },
  );
  const malformedOverCap = `\ud800${'a'.repeat(policy.profileLimits.maxSourceScalars)}`;
  const malformedCount = String(Array.from(malformedOverCap).length);
  const malformedSourceLimit = [
    policy.resultFormat,
    'failure',
    `C12:SOURCE_LIMITS1:0E${malformedCount.length}:${malformedCount}`,
    malformedCount,
    '0',
    '0',
    '0',
    '',
    'failure',
  ];
  reject(malformedSourceLimit, malformedOverCap, 'ill-formed-before-source-limit');
  return rejected.sort();
}

function assertRejected(fields, source, policy, name, options = {}) {
  try {
    decodeScan(fields, source, policy, options);
  } catch {
    return;
  }
  throw new Error(`F1 fabricated receipt survived: ${name}`);
}
