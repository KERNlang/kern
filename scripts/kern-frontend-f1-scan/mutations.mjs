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

export function rejectedMutations(fields, source, policy) {
  const mutations = new Map([
    ['constant-output', [...fields.slice(0, 7), '', fields[8]]],
    ['drop-record', changed(fields, (chunks) => chunks[0].records.splice(0, 1))],
    ['duplicate-record', changed(fields, (chunks) => chunks[0].records.splice(1, 0, structuredClone(chunks[0].records[0])))],
    ['reorder-record', changed(fields, (chunks) => {
      [chunks[0].records[0], chunks[0].records[1]] = [chunks[0].records[1], chunks[0].records[0]];
    })],
    ['class-drift', changed(fields, (chunks) => { chunks[0].records[0].className = 'trivia'; })],
    ['kind-drift', changed(fields, (chunks) => { chunks[0].records[0].kind = '999'; })],
    ['flag-drift', changed(fields, (chunks) => { chunks[0].records[0].kind = '1'; })],
    ['span-drift', changed(fields, (chunks) => { chunks[0].records[0].startScalar = 1; })],
    ['swallowed-newline', changed(fields, (chunks) => {
      const record = chunks.flatMap((chunk) => chunk.records).find((entry) => entry.raw === '\n');
      record.raw = 'x';
    })],
    ['marker-drift', changed(fields, (chunks) => {
      const marker = chunks.flatMap((chunk) => chunk.records).find((entry) => entry.kind === '105');
      marker.kind = '106';
    })],
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
