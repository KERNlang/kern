import { normalizeStitchOracle } from '../kern-frontend-stitcher/oracle.mjs';

export function normalizeIndentationOracle(source, rawTypes) {
  const stitch = normalizeStitchOracle(source, rawTypes);
  const physicalStartCodeUnits = [];
  const physicalContents = source === '' ? [''] : source.split('\n');
  if (source.endsWith('\n')) physicalContents.pop();
  let nextStartCodeUnit = 0;
  for (const content of physicalContents) {
    physicalStartCodeUnits.push(nextStartCodeUnit);
    nextStartCodeUnit += content.length + 1;
  }
  const observations = [];
  let previousIndentLength;
  for (const [groupIndex, group] of stitch.groups.entries()) {
    if (group.termination !== 'complete') continue;
    const firstPhysicalIndex = group.physicalIndexes[0];
    const first = stitch.physical[firstPhysicalIndex];
    const indentBytes = /^[\t ]*/u.exec(first.content)?.[0] ?? '';
    let relation = 'initial';
    if (previousIndentLength !== undefined) {
      relation = indentBytes.length === previousIndentLength
        ? 'same'
        : indentBytes.length > previousIndentLength ? 'deeper' : 'shallower';
    }
    observations.push({
      contentEndByte: first.contentEndByte,
      firstContentByte: first.startByte + Buffer.byteLength(indentBytes),
      firstContentCodeUnit: physicalStartCodeUnits[firstPhysicalIndex] + indentBytes.length,
      firstPhysicalIndex,
      firstRecordContent: first.content,
      groupIndex,
      indentBytes,
      physicalIndexes: [...group.physicalIndexes],
      relation,
      startByte: first.startByte,
    });
    previousIndentLength = indentBytes.length;
  }
  return { format: 'kern.frontend.indentation-shadow.1', observations };
}
