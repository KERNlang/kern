export function buildPrerequisiteInput(prepared, testOptions = {}) {
  const { authorities, prerequisiteOutcome: outcome } = prepared;
  const states = testOptions.prerequisiteStates ?? outcome.prerequisiteStates;
  const f1Available = states[0] === 'available';
  const f2bAvailable = states[1] === 'available';
  const f3Available = states[2] === 'available';
  const records = f1Available ? outcome.scan?.decoded.records ?? [] : [];
  const segments = f2bAvailable ? outcome.batch?.receipt.segments ?? [] : [];
  const document = f3Available ? outcome.document : undefined;
  const lines = document?.receipt.logicalLines ?? [];
  const edges = document?.receipt.parentEdges ?? [];
  const decorators = document?.receipt.decoratorRuns ?? [];
  const raw = document?.receipt.rawBlocks ?? [];
  const sourcePoints = Array.from(prepared.source);
  const input = {
    authorities: structuredClone(authorities),
    recordKinds: records.map((row) => row.kindId),
    recordFlags: records.map((row) => row.flags),
    recordStarts: records.map((row) => row.startScalar),
    recordEnds: records.map((row) => row.endScalar),
    f1RecordTape: f1Available ? outcome.scan?.fields[7] ?? '' : '',
    segmentFirstRecords: segments.map((row) => row.firstRecordOrdinal),
    segmentLastRecords: segments.map((row) => row.lastRecordOrdinal),
    segmentOuterStarts: segments.map((row) => row.outerStartScalar),
    segmentOuterEnds: segments.map((row) => row.outerEndScalar),
    segmentBodyStarts: segments.map((row) => row.bodyStartScalar),
    segmentBodyEnds: segments.map((row) => row.bodyEndScalar),
    f3ExpectedFields: document === undefined ? [] : [...document.fields],
    segmentBodies: segments.map((row) => sourcePoints.slice(row.bodyStartScalar, row.bodyEndScalar).join('')),
    segmentBodyDigests: segments.map((row) => row.bodySha256),
    segmentRecordDigests: segments.map((row) => row.recordSha256),
    f2bExpectedFields: f2bAvailable && outcome.batch !== undefined ? [...outcome.batch.fields] : [],
    lineFirstRecords: lines.map((row) => row.firstRecordOrdinal),
    lineLastRecords: lines.map((row) => row.lastRecordOrdinal),
    lineStarts: lines.map((row) => row.sourceStartScalar),
    lineEnds: lines.map((row) => row.sourceEndScalar),
    lineFirstPhysical: lines.map((row) => row.firstPhysicalLine),
    lineLastPhysical: lines.map((row) => row.lastPhysicalLine),
    lineIndents: lines.map((row) => row.indentScalarCount),
    lineContentStarts: lines.map((row) => row.contentStartScalar),
    lineRoles: lines.map((row) => row.role),
    lineFirstSegments: lines.map((row) => row.firstSegmentOrdinal),
    lineSegmentCounts: lines.map((row) => row.segmentCount),
    edgeChildren: edges.map((row) => row.childLogicalOrdinal),
    edgeParents: edges.map((row) => row.parentLogicalOrdinal),
    edgeChildIndents: edges.map((row) => row.childIndent),
    edgeParentIndents: edges.map((row) => row.parentIndent),
    decoratorFirsts: decorators.map((row) => row.firstDecoratorOrdinal),
    decoratorLasts: decorators.map((row) => row.lastDecoratorOrdinal),
    decoratorSuccessors: decorators.map((row) => row.successorOrdinal),
    decoratorDispositions: decorators.map((row) => row.disposition),
    rawOwners: raw.map((row) => row.ownerLogicalOrdinal),
    rawOpeners: raw.map((row) => row.openerRecordOrdinal),
    rawClosers: raw.map((row) => row.closerRecordOrdinal),
    rawBodyStarts: raw.map((row) => row.bodyStartScalar),
    rawBodyEnds: raw.map((row) => row.bodyEndScalar),
    rawInlineFlags: raw.map((row) => row.inlineFlag),
    rawTypes: raw.map((row) => row.recognizedMultilineType),
    prerequisiteStates: [...states],
  };
  return input;
}
