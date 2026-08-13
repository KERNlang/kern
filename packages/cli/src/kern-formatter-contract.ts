export const KERN_FORMATTER_REQUEST_FORMAT = 'kern.formatter.request.1';
export const KERN_FORMATTER_RESULT_FORMAT = 'kern.formatter.result.1';

export interface KernFormatterRequest {
  readonly format: typeof KERN_FORMATTER_REQUEST_FORMAT;
  readonly source: string;
}

export interface KernFormatterLimits {
  readonly maxCodePoints: number;
  readonly maxInputBytes: number;
}

const textEncoder = new TextEncoder();
const trustedFailurePrefixes = Object.freeze([
  'KERN formatter asset rejection:',
  'KERN formatter policy rejection:',
  'KERN formatter request rejection:',
  'KERN formatter transport rejection:',
]);

export function safeKernFormatterErrorMessage(error: unknown): string {
  if (error instanceof Error && trustedFailurePrefixes.some((prefix) => error.message.startsWith(prefix))) {
    return error.message;
  }
  return 'KERN formatter internal contract rejection';
}

function fail(detail: string): never {
  throw new TypeError(`KERN formatter request rejection: ${detail}`);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function validateKernFormatterRequest(input: unknown, limits: KernFormatterLimits): KernFormatterRequest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('request must be a record');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.getOwnPropertySymbols(input).length > 0 ||
    Object.values(descriptors).some((item) => item.get || item.set || !item.enumerable || !('value' in item))
  ) {
    fail('request must contain plain inspectable fields');
  }
  const keys = Object.keys(descriptors).sort();
  if (keys.length !== 2 || keys[0] !== 'format' || keys[1] !== 'source') fail('request fields are unsupported');
  const record = input as Record<string, unknown>;
  if (record.format !== KERN_FORMATTER_REQUEST_FORMAT) fail('format is unsupported');
  if (typeof record.source !== 'string') fail('source must be text');
  if (!isWellFormedUnicode(record.source)) fail('source must be well-formed Unicode');
  if ([...record.source].length > limits.maxCodePoints) fail('source exceeds maxCodePoints');
  if (textEncoder.encode(JSON.stringify(input)).length > limits.maxInputBytes) fail('request exceeds maxInputBytes');
  return structuredClone(input) as KernFormatterRequest;
}
