/**
 * Source Map v3 Serializer
 *
 * Serializes KERN's SourceMapEntry[] into the standard Source Map v3 JSON format
 * (https://sourcemaps.info/spec.html). This enables debuggers and editors to map
 * generated TypeScript back to the original .kern source.
 */

import type { SourceMapEntry } from './types.js';

/** Standard Source Map v3 JSON structure */
export interface SourceMapV3 {
  version: 3;
  file: string;
  sourceRoot: string;
  sources: string[];
  names: string[];
  mappings: string;
}

/**
 * Serialize KERN source map entries to a standard Source Map v3 JSON object.
 *
 * @param entries - Array of KERN source map entries (IR position → output position)
 * @param file - The generated output filename (e.g., `'Home.tsx'`)
 * @param source - The original .kern source filename (e.g., `'Home.kern'`)
 * @param sourceRoot - Optional root path for sources (default: `''`)
 * @returns A Source Map v3 JSON object ready for `JSON.stringify()`
 */
export function serializeSourceMap(
  entries: SourceMapEntry[],
  file: string,
  source: string,
  sourceRoot = '',
): SourceMapV3 {
  // Sort by output position for correct VLQ encoding
  const sorted = [...entries].sort((a, b) => a.outLine - b.outLine || a.outCol - b.outCol);

  const mappings = encodeMappings(sorted);

  return {
    version: 3,
    file,
    sourceRoot,
    sources: [source],
    names: [],
    mappings,
  };
}

/**
 * Encode sorted source map entries into the VLQ-encoded `mappings` string.
 *
 * Each line is separated by `;`. Within a line, segments are separated by `,`.
 * Each segment has 4 fields: outCol, sourceIndex (always 0), irLine, irCol.
 * All are relative to the previous segment (VLQ delta encoding).
 */
function encodeMappings(entries: SourceMapEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[][] = [];
  let prevOutCol = 0;
  let prevIrLine = 0;
  let prevIrCol = 0;
  let currentLine = -1;

  for (const entry of entries) {
    const outLine = entry.outLine - 1; // 0-indexed in v3
    const outCol = entry.outCol - 1;
    const irLine = entry.irLine - 1;
    const irCol = entry.irCol - 1;

    // Fill empty lines
    while (currentLine < outLine) {
      currentLine++;
      lines.push([]);
      prevOutCol = 0; // reset column at each new line
    }

    // Encode segment: [outCol, sourceIdx=0, irLine, irCol]
    const segment =
      encodeVLQ(outCol - prevOutCol) +
      encodeVLQ(0) + // source index delta (always 0, single source)
      encodeVLQ(irLine - prevIrLine) +
      encodeVLQ(irCol - prevIrCol);

    lines[currentLine].push(segment);

    prevOutCol = outCol;
    prevIrLine = irLine;
    prevIrCol = irCol;
  }

  return lines.map((segs) => segs.join(',')).join(';');
}

/** Encode a single integer as a Base64 VLQ string. */
function encodeVLQ(value: number): string {
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';

  do {
    let digit = vlq & 0x1f; // 5 bits
    vlq >>>= 5;
    if (vlq > 0) digit |= 0x20; // continuation bit
    encoded += BASE64[digit];
  } while (vlq > 0);

  return encoded;
}
