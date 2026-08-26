import { KernKirFault, type KernKirValue } from './contracts.js';
import { compareCodePoints, type RuntimeMeter } from './inspect.js';

const HEX = /^[0-9a-fA-F]{4}$/u;

function rejected(message: string): never {
  throw new KernKirFault('unsupported-runtime-input', 'execution', message);
}

class KirJsonReader {
  private index = 0;
  private readonly meter: RuntimeMeter;
  private readonly source: string;

  constructor(source: string, meter: RuntimeMeter) {
    this.source = source;
    this.meter = meter;
  }

  read(): KernKirValue {
    this.space();
    const value = this.value(1);
    this.space();
    if (this.index !== this.source.length) rejected('Json.parse has trailing input');
    return value;
  }

  private space(): void {
    while (this.index < this.source.length && /[\u0009\u000a\u000d\u0020]/u.test(this.source[this.index])) {
      if ((this.index & 1023) === 0) this.meter.check();
      this.index += 1;
    }
  }

  private value(depth: number): KernKirValue {
    this.meter.step();
    if (depth > this.meter.limits.maxDepth) {
      throw new KernKirFault('runtime-limit-exceeded', 'execution', 'Json.parse exceeds depth limit');
    }
    const character = this.source[this.index];
    if (character === '"') return Object.freeze({ tag: 'text', value: this.string() });
    if (character === '[') return this.list(depth);
    if (character === '{') return this.record(depth);
    if (this.source.startsWith('null', this.index)) {
      this.index += 4;
      return Object.freeze({ tag: 'null' });
    }
    if (this.source.startsWith('true', this.index)) {
      this.index += 4;
      return Object.freeze({ tag: 'boolean', value: true });
    }
    if (this.source.startsWith('false', this.index)) {
      this.index += 5;
      return Object.freeze({ tag: 'boolean', value: false });
    }
    return this.number();
  }

  private string(): string {
    this.index += 1;
    let result = '';
    while (this.index < this.source.length) {
      if ((this.index & 1023) === 0) this.meter.check();
      const character = this.source[this.index++];
      if (character === '"') return this.meter.text(result, 'Json.parse string');
      if (character.charCodeAt(0) < 0x20) rejected('Json.parse string contains a control character');
      if (character !== '\\') {
        result += character;
        continue;
      }
      const escapeCode = this.source[this.index++];
      if (escapeCode === undefined) rejected('Json.parse has an incomplete escape');
      const simple: Readonly<Record<string, string>> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (Object.hasOwn(simple, escapeCode)) {
        result += simple[escapeCode];
        continue;
      }
      if (escapeCode !== 'u') rejected('Json.parse has an invalid escape');
      const first = this.unicodeUnit();
      if (first >= 0xd800 && first <= 0xdbff) {
        if (this.source.slice(this.index, this.index + 2) !== '\\u') rejected('Json.parse has a lone high surrogate');
        this.index += 2;
        const second = this.unicodeUnit();
        if (second < 0xdc00 || second > 0xdfff) rejected('Json.parse has a malformed surrogate pair');
        result += String.fromCharCode(first, second);
      } else {
        if (first >= 0xdc00 && first <= 0xdfff) rejected('Json.parse has a lone low surrogate');
        result += String.fromCharCode(first);
      }
    }
    rejected('Json.parse has an unterminated string');
  }

  private unicodeUnit(): number {
    const digits = this.source.slice(this.index, this.index + 4);
    if (!HEX.test(digits)) rejected('Json.parse has an invalid unicode escape');
    this.index += 4;
    return Number.parseInt(digits, 16);
  }

  private list(depth: number): KernKirValue {
    this.index += 1;
    this.space();
    const items: KernKirValue[] = [];
    if (this.source[this.index] === ']') {
      this.index += 1;
      return Object.freeze({ tag: 'list', value: Object.freeze(items) });
    }
    while (true) {
      items.push(this.value(depth + 1));
      this.meter.collection(items.length, 'Json.parse list');
      this.space();
      const delimiter = this.source[this.index++];
      if (delimiter === ']') break;
      if (delimiter !== ',') rejected('Json.parse list expects comma or closing bracket');
      this.space();
    }
    return Object.freeze({ tag: 'list', value: Object.freeze(items) });
  }

  private record(depth: number): KernKirValue {
    this.index += 1;
    this.space();
    const fields = new Map<string, KernKirValue>();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return Object.freeze({ tag: 'record', value: Object.freeze([]) });
    }
    while (true) {
      if (this.source[this.index] !== '"') rejected('Json.parse record expects a string key');
      const key = this.string();
      if (fields.has(key)) rejected('Json.parse rejects duplicate record keys');
      this.space();
      if (this.source[this.index++] !== ':') rejected('Json.parse record expects a colon');
      this.space();
      fields.set(key, this.value(depth + 1));
      this.meter.collection(fields.size, 'Json.parse record');
      this.space();
      const delimiter = this.source[this.index++];
      if (delimiter === '}') break;
      if (delimiter !== ',') rejected('Json.parse record expects comma or closing brace');
      this.space();
    }
    const entries = [...fields.entries()]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, value]) => Object.freeze({ key, value }));
    return Object.freeze({ tag: 'record', value: Object.freeze(entries) });
  }

  private number(): KernKirValue {
    this.meter.check();
    const remainder = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/u.exec(remainder);
    if (!match) rejected('Json.parse expects a portable JSON value');
    const token = match[0];
    this.meter.check();
    const next = remainder[token.length];
    if (next === 'e' || next === 'E' || next === '.' || /[0-9A-Za-z_+-]/u.test(next ?? '')) {
      rejected('Json.parse rejects non-canonical or exponent numbers');
    }
    if (token === '-0') rejected('Json.parse rejects negative zero');
    this.index += token.length;
    this.meter.text(token, 'Json.parse number');
    return token.includes('.')
      ? Object.freeze({ tag: 'decimal', value: token })
      : Object.freeze({ tag: 'integer', value: token });
  }
}

export function quoteKernJsonString(value: string, check: () => void = () => {}): string {
  let output = '"';
  for (let index = 0; index < value.length; index += 1) {
    if ((index & 1023) === 0) check();
    const character = value[index];
    const code = value.charCodeAt(index);
    if (character === '"' || character === '\\') output += `\\${character}`;
    else if (character === '\b') output += '\\b';
    else if (character === '\f') output += '\\f';
    else if (character === '\n') output += '\\n';
    else if (character === '\r') output += '\\r';
    else if (character === '\t') output += '\\t';
    else if (code < 0x20) output += `\\u${code.toString(16).padStart(4, '0')}`;
    else output += character;
  }
  return `${output}"`;
}

export function encodeKernJson(value: KernKirValue, check: () => void = () => {}): string {
  check();
  switch (value.tag) {
    case 'null':
      return 'null';
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'text':
      return quoteKernJsonString(value.value, check);
    case 'integer':
    case 'decimal':
      return value.value;
    case 'list':
      return `[${value.value.map((item) => encodeKernJson(item, check)).join(',')}]`;
    case 'record':
      return `{${value.value.map((entry) => `${quoteKernJsonString(entry.key, check)}:${encodeKernJson(entry.value, check)}`).join(',')}}`;
  }
}

function write(value: KernKirValue, meter: RuntimeMeter, depth: number): string {
  meter.step();
  if (depth > meter.limits.maxDepth) {
    throw new KernKirFault('runtime-limit-exceeded', 'execution', 'Json.stringify exceeds depth limit');
  }
  switch (value.tag) {
    case 'null':
      return 'null';
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'text':
      return quoteKernJsonString(value.value);
    case 'integer':
    case 'decimal':
      return value.value;
    case 'list':
      meter.collection(value.value.length, 'Json.stringify list');
      return `[${value.value.map((item) => write(item, meter, depth + 1)).join(',')}]`;
    case 'record':
      meter.collection(value.value.length, 'Json.stringify record');
      return `{${value.value.map((entry) => `${quoteKernJsonString(entry.key)}:${write(entry.value, meter, depth + 1)}`).join(',')}}`;
  }
}

export function parseKernJson(source: string, meter: RuntimeMeter): KernKirValue {
  return new KirJsonReader(source, meter).read();
}

export function stringifyKernJson(value: KernKirValue, meter: RuntimeMeter): string {
  return meter.text(write(value, meter, 1), 'Json.stringify result');
}
