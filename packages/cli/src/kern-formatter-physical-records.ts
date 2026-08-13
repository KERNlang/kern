export const KERN_FORMATTER_PHYSICAL_RECORDS_FORMAT = 'kern.formatter.physical-records.1';

export interface KernFormatterPhysicalLimits {
  readonly maxRecordCodePoints: number;
  readonly maxRecords: number;
}

export class KernFormatterPhysicalRecordError extends TypeError {
  constructor(
    readonly code: 'BARE_CR' | 'RECORD_CODE_POINTS_LIMIT' | 'RECORD_LIMIT',
    readonly detail: string,
  ) {
    super(`KERN formatter physical-record rejection: ${code}${detail ? ` at ${detail}` : ''}`);
    this.name = 'KernFormatterPhysicalRecordError';
  }
}

function appendRecord(
  tape: string[],
  ordinal: number,
  content: string,
  terminator: 'crlf' | 'lf' | 'none',
  limits: KernFormatterPhysicalLimits,
): void {
  if (ordinal >= limits.maxRecords) throw new KernFormatterPhysicalRecordError('RECORD_LIMIT', '');
  if ([...content].length > limits.maxRecordCodePoints) {
    throw new KernFormatterPhysicalRecordError('RECORD_CODE_POINTS_LIMIT', String(ordinal));
  }
  tape.push('record', String(ordinal), content, terminator);
}

export function createKernFormatterPhysicalRecords(
  source: string,
  limits: KernFormatterPhysicalLimits,
): readonly string[] {
  const tape = [KERN_FORMATTER_PHYSICAL_RECORDS_FORMAT];
  let ordinal = 0;
  let start = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const codeUnit = source.charCodeAt(cursor);
    if (codeUnit === 0x0a) {
      appendRecord(tape, ordinal, source.slice(start, cursor), 'lf', limits);
      ordinal += 1;
      cursor += 1;
      start = cursor;
      continue;
    }
    if (codeUnit === 0x0d) {
      if (cursor + 1 >= source.length || source.charCodeAt(cursor + 1) !== 0x0a) {
        throw new KernFormatterPhysicalRecordError('BARE_CR', String(ordinal));
      }
      appendRecord(tape, ordinal, source.slice(start, cursor), 'crlf', limits);
      ordinal += 1;
      cursor += 2;
      start = cursor;
      continue;
    }
    cursor += 1;
  }
  if (start < source.length) {
    appendRecord(tape, ordinal, source.slice(start), 'none', limits);
    ordinal += 1;
  }
  tape.push('seal', String(ordinal));
  return Object.freeze(tape);
}
