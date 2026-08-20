const DEFAULT_RAW_OPENERS = ['body', 'cleanup', 'doc', 'handler', 'logic', 'render'];

export function computeGeometryOracle(records, segments, source, rawOpenerTypes = DEFAULT_RAW_OPENERS) {
  const logicalLines = [];
  const rawBlocks = [];
  const diagnostics = [];

  let physicalLine = 1;
  let recordIdx = 0;

  while (recordIdx < records.length) {
    const lineStartRec = recordIdx;
    const startLineNum = physicalLine;

    // Scan the current physical line records
    let lineRecs = [];
    while (recordIdx < records.length) {
      const rec = records[recordIdx];
      lineRecs.push(rec);
      recordIdx += 1;
      if (rec.kind === 'newline') {
        physicalLine += 1;
        break;
      }
    }

    // Check if line is blank or comment-only
    const nonWs = lineRecs.filter((r) => r.kind !== 'whitespace' && r.kind !== 'newline');
    if (nonWs.length === 0) continue; // blank line
    if (nonWs.length === 1 && nonWs[0].kind === 'comment') continue; // comment-only line

    // It's a semantic line starting a logical row.
    // Check if we need to continue across multiple physical lines due to unclosed composite modes
    let openQuote = false;
    let openExpr = false;
    let openFence = false;

    function checkRecord(r) {
      if (r.kind === 'quoted') {
        if ((r.flags & 1) !== 0) openQuote = true;
        if ((r.flags & 2) !== 0) openQuote = false;
      } else if (r.kind === 'expr') {
        if ((r.flags & 1) !== 0) openExpr = true;
        if ((r.flags & 2) !== 0) openExpr = false;
      } else if (r.kind === 'fenceMarker') {
        if (r.flags === 1) openFence = true;
        if (r.flags === 2) openFence = false;
      }
    }

    for (const r of lineRecs) checkRecord(r);

    let endLineNum = startLineNum;
    let allLogicalRecs = [...lineRecs];

    let continuationActive = openQuote || openExpr || openFence;
    while (continuationActive && recordIdx < records.length) {
      const rec = records[recordIdx];
      allLogicalRecs.push(rec);
      checkRecord(rec);
      recordIdx += 1;
      if (rec.kind === 'newline') {
        physicalLine += 1;
        endLineNum = physicalLine - 1;
        if (!openQuote && !openExpr && !openFence) continuationActive = false;
      } else {
        endLineNum = physicalLine;
      }
    }

    const firstRec = allLogicalRecs[0];
    const lastRec = allLogicalRecs[allLogicalRecs.length - 1];
    const ordinal = logicalLines.length;
    const sourceStartScalar = firstRec.startScalar;
    const sourceEndScalar = lastRec.kind === 'newline' ? lastRec.startScalar : lastRec.endScalar;

    let indentScalarCount = 0;
    let contentStartScalar = sourceStartScalar;

    if (firstRec.kind === 'whitespace') {
      indentScalarCount = firstRec.endScalar - firstRec.startScalar;
      contentStartScalar = firstRec.endScalar;
      if (firstRec.raw.includes('\t')) {
        diagnostics.push({
          code: 'INVALID_INDENT',
          startScalar: sourceStartScalar,
          endScalar: contentStartScalar,
          logicalOrdinal: ordinal,
        });
      }
    }

    const firstContentRec = allLogicalRecs.find((r) => r.kind !== 'whitespace' && r.kind !== 'newline');
    let role = 'ordinary';

    if (firstContentRec && firstContentRec.kind === 'unknown' && firstContentRec.raw === '@') {
      role = 'decorator';
    } else {
      const fenceOpener = allLogicalRecs.find((r) => r.kind === 'fenceMarker' && r.flags === 1);
      if (fenceOpener) {
        if (firstContentRec && firstContentRec.kind === 'identifier' && rawOpenerTypes.includes(firstContentRec.raw)) {
          role = 'raw-owner';
          const fenceCloser = allLogicalRecs.find((r) => r.kind === 'fenceMarker' && r.flags === 2);
          const bodyStart = fenceOpener.endScalar;
          const bodyEnd = fenceCloser ? fenceCloser.startScalar : bodyStart;
          const inlineFlag = startLineNum === endLineNum ? 'true' : 'false';
          rawBlocks.push({
            rawOrdinal: rawBlocks.length,
            ownerLogicalOrdinal: ordinal,
            openerRecordOrdinal: fenceOpener.ordinal,
            closerRecordOrdinal: fenceCloser ? fenceCloser.ordinal : -1,
            bodyStartScalar: bodyStart,
            bodyEndScalar: bodyEnd,
            inlineFlag,
            recognizedMultilineType: firstContentRec.raw,
          });
        } else if (!firstContentRec || firstContentRec.kind !== 'identifier') {
          role = 'error';
          diagnostics.push({
            code: 'DROPPED_LINE',
            startScalar: contentStartScalar,
            endScalar: sourceEndScalar,
            logicalOrdinal: ordinal,
          });
        } else {
          role = 'ordinary';
        }
      } else if (!firstContentRec || firstContentRec.kind !== 'identifier') {
        role = 'error';
        diagnostics.push({
          code: 'DROPPED_LINE',
          startScalar: contentStartScalar,
          endScalar: sourceEndScalar,
          logicalOrdinal: ordinal,
        });
      }
    }

    // Bind contained F2B segments
    const containedSegments = segments.filter(
      (s) => s.firstRecordOrdinal >= firstRec.ordinal && s.lastRecordOrdinal <= lastRec.ordinal,
    );
    const firstSegmentOrdinal = containedSegments.length > 0 ? containedSegments[0].ordinal : -1;
    const segmentCount = containedSegments.length;

    logicalLines.push({
      ordinal,
      firstRecordOrdinal: firstRec.ordinal,
      lastRecordOrdinal: lastRec.ordinal,
      sourceStartScalar,
      sourceEndScalar,
      firstPhysicalLine: startLineNum,
      lastPhysicalLine: endLineNum,
      indentScalarCount,
      contentStartScalar,
      role,
      firstSegmentOrdinal,
      segmentCount,
    });
  }

  // Parent edges and INDENT_JUMP
  const parentEdges = [];
  const stack = [];
  const seenIndents = new Set();
  let prevNonDecoratorIndent = -1;

  for (const line of logicalLines) {
    if (line.role === 'decorator') continue;
    const indent = line.indentScalarCount;
    if (prevNonDecoratorIndent >= 0 && indent < prevNonDecoratorIndent && !seenIndents.has(indent)) {
      diagnostics.push({
        code: 'INDENT_JUMP',
        startScalar: line.sourceStartScalar,
        endScalar: line.contentStartScalar,
        logicalOrdinal: line.ordinal,
      });
    }
    seenIndents.add(indent);

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parentOrdinal = stack.length === 0 ? -1 : stack[stack.length - 1].ordinal;
    const parentIndent = stack.length === 0 ? -1 : stack[stack.length - 1].indent;

    parentEdges.push({
      childLogicalOrdinal: line.ordinal,
      parentLogicalOrdinal: parentOrdinal,
      childIndent: indent,
      parentIndent,
    });

    stack.push({ ordinal: line.ordinal, indent });
    prevNonDecoratorIndent = indent;
  }

  // Decorator adjacency runs
  const decoratorRuns = [];
  let i = 0;
  while (i < logicalLines.length) {
    if (logicalLines[i].role === 'decorator') {
      const runStart = i;
      const runIndent = logicalLines[i].indentScalarCount;
      let j = i;
      while (j + 1 < logicalLines.length && logicalLines[j + 1].role === 'decorator' && logicalLines[j + 1].indentScalarCount === runIndent) {
        j += 1;
      }
      const runEnd = j;
      const nextIdx = runEnd + 1;
      let successorOrdinal = -1;
      let disposition = 'orphan-eof';
      if (nextIdx < logicalLines.length) {
        successorOrdinal = logicalLines[nextIdx].ordinal;
        if (logicalLines[nextIdx].indentScalarCount === runIndent) {
          disposition = 'candidate';
        } else {
          disposition = 'orphan-indent';
        }
      }
      decoratorRuns.push({
        runOrdinal: decoratorRuns.length,
        firstDecoratorOrdinal: runStart,
        lastDecoratorOrdinal: runEnd,
        successorOrdinal,
        disposition,
      });
      i = j + 1;
    } else {
      i += 1;
    }
  }

  // Sort diagnostics by source startScalar, then endScalar, then code
  diagnostics.sort((a, b) => a.startScalar - b.startScalar || a.endScalar - b.endScalar || a.code.localeCompare(b.code));

  return {
    logicalLines,
    parentEdges,
    decoratorRuns,
    rawBlocks,
    diagnostics,
    sourceScalars: Array.from(source).length,
  };
}
