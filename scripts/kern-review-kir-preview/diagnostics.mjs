export const MAX_FAILURE_DIAGNOSTIC_BYTES = 8 * 1024;
export const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const MAX_FAILURE_DIAGNOSTIC_LINES = 80;
const SENSITIVE_KEY = '(?:api[_-]?key|password|token|secret(?:[_-]?(?:access|key|value))?|aws_secret_access_key)';

function createTailBuffer(maxBytes) {
  const buffer = Buffer.allocUnsafe(maxBytes);
  let byteLength = 0;
  let writeOffset = 0;

  return {
    append(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (value.length === 0) return;
      const tail = value.length > maxBytes ? value.subarray(value.length - maxBytes) : value;
      const firstLength = Math.min(tail.length, maxBytes - writeOffset);
      tail.copy(buffer, writeOffset, 0, firstLength);
      if (firstLength < tail.length) tail.copy(buffer, 0, firstLength);
      writeOffset = (writeOffset + tail.length) % maxBytes;
      byteLength = Math.min(maxBytes, byteLength + tail.length);
    },
    get byteLength() {
      return byteLength;
    },
    text() {
      if (byteLength < maxBytes) return buffer.subarray(0, byteLength).toString('utf8');
      return Buffer.concat([buffer.subarray(writeOffset), buffer.subarray(0, writeOffset)]).toString('utf8');
    },
  };
}

export function createBoundedTailCollector(maxBytes = MAX_CHILD_OUTPUT_BYTES) {
  return {
    stdout: createTailBuffer(maxBytes),
    stderr: createTailBuffer(maxBytes),
  };
}

function redactSensitiveValues(value) {
  return value
    .replace(/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gu, (privateKey) => {
      const [header] = privateKey.match(/-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/u);
      const [footer] = privateKey.match(/-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/u);
      return `${header}\n[REDACTED PRIVATE KEY]\n${footer}`;
    })
    .replace(/(\b(?:proxy-)?authorization\s*:\s*basic\s+)[^\r\n]+/giu, '$1[REDACTED]')
    .replace(/(\bbasic\s+)[^\s]+/giu, '$1[REDACTED]')
    .replace(/(bearer\s+)[^\s]+/giu, '$1[REDACTED]')
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^/\s:@]+:[^@/\s]+@/giu, '$1[REDACTED]@')
    .replace(new RegExp(`((?:"${SENSITIVE_KEY}"|${SENSITIVE_KEY})\\s*:\\s*)"(?:(?:\\\\.)|[^"\\\\])*"`, 'giu'), '$1"[REDACTED]"')
    .replace(new RegExp(`(\\b${SENSITIVE_KEY}\\b\\s*(?:=|:)\\s*)(?:"(?:(?:\\\\.)|[^"\\\\])*"|'[^'\\r\\n]*'|[^\\r\\n]*)`, 'giu'), '$1[REDACTED]');
}

function truncateUtf8(value) {
  if (Buffer.byteLength(value, 'utf8') <= MAX_FAILURE_DIAGNOSTIC_BYTES) return value;

  const suffix = '\n[diagnostic excerpt truncated]';
  let excerpt = Buffer.from(value, 'utf8')
    .subarray(0, MAX_FAILURE_DIAGNOSTIC_BYTES - Buffer.byteLength(suffix, 'utf8'))
    .toString('utf8');
  while (Buffer.byteLength(excerpt + suffix, 'utf8') > MAX_FAILURE_DIAGNOSTIC_BYTES) excerpt = excerpt.slice(0, -1);
  return excerpt + suffix;
}

export function failureExcerpt(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const lines = output.split(/\r?\n/u);
  const failedTestIndex = lines.findIndex((line) => line.startsWith('not ok'));
  if (failedTestIndex === -1) {
    const excerpt = lines.slice(-MAX_FAILURE_DIAGNOSTIC_LINES).join('\n').trim();
    return truncateUtf8(redactSensitiveValues(excerpt || 'no failure detail'));
  }
  const start = failedTestIndex > 0 && lines[failedTestIndex - 1].startsWith('# Subtest:')
    ? failedTestIndex - 1
    : failedTestIndex;
  const nextTestIndex = lines.slice(failedTestIndex + 1).findIndex((line) => /^(?:ok|not ok)\b/u.test(line));
  const end = nextTestIndex === -1 ? lines.length : failedTestIndex + nextTestIndex + 1;
  const excerptLines = lines.slice(start, end)
    .slice(0, MAX_FAILURE_DIAGNOSTIC_LINES);
  const excerpt = excerptLines.join('\n').trim();
  return truncateUtf8(redactSensitiveValues(excerpt || 'no failure detail'));
}
