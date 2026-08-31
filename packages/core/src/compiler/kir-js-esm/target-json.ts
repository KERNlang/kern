export const TARGET_JSON_SOURCE = String.raw`
  const __jsonRejected = () => { throw new __Fault('unsupported-runtime-input', 'execution'); };
  class __JsonReader {
    constructor(source, meter) {
      this.source = source;
      this.meter = meter;
      this.index = 0;
    }
    read() {
      this.space();
      const value = this.readValue(1);
      this.space();
      if (this.index !== this.source.length) __jsonRejected();
      return value;
    }
    space() {
      while (this.index < this.source.length && /[\u0009\u000a\u000d\u0020]/u.test(this.source[this.index])) {
        if ((this.index & 1023) === 0) this.meter.check();
        this.index += 1;
      }
    }
    readValue(depth) {
      this.meter.step();
      if (depth > this.meter.limits.maxDepth) throw new __Fault('runtime-limit-exceeded', 'execution');
      const character = this.source[this.index];
      if (character === '"') return Object.freeze({ tag: 'text', value: this.readString() });
      if (character === '[') return this.readList(depth);
      if (character === '{') return this.readRecord(depth);
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
      return this.readNumber();
    }
    readString() {
      this.index += 1;
      let result = '';
      while (this.index < this.source.length) {
        if ((this.index & 1023) === 0) this.meter.check();
        const character = this.source[this.index++];
        if (character === '"') return this.meter.text(result);
        if (character.charCodeAt(0) < 0x20) __jsonRejected();
        if (character !== '\\') {
          result += character;
          continue;
        }
        const escapeCode = this.source[this.index++];
        if (escapeCode === undefined) __jsonRejected();
        const simple = Object.freeze({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' });
        if (Object.hasOwn(simple, escapeCode)) {
          result += simple[escapeCode];
          continue;
        }
        if (escapeCode !== 'u') __jsonRejected();
        const first = this.unicodeUnit();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.source.slice(this.index, this.index + 2) !== '\\u') __jsonRejected();
          this.index += 2;
          const second = this.unicodeUnit();
          if (second < 0xdc00 || second > 0xdfff) __jsonRejected();
          result += String.fromCharCode(first, second);
        } else {
          if (first >= 0xdc00 && first <= 0xdfff) __jsonRejected();
          result += String.fromCharCode(first);
        }
      }
      __jsonRejected();
    }
    unicodeUnit() {
      const digits = this.source.slice(this.index, this.index + 4);
      if (!/^[0-9a-fA-F]{4}$/u.test(digits)) __jsonRejected();
      this.index += 4;
      return Number.parseInt(digits, 16);
    }
    readList(depth) {
      this.index += 1;
      this.space();
      const items = [];
      if (this.source[this.index] === ']') {
        this.index += 1;
        return Object.freeze({ tag: 'list', value: Object.freeze(items) });
      }
      while (true) {
        items.push(this.readValue(depth + 1));
        this.meter.collection(items.length);
        this.space();
        const delimiter = this.source[this.index++];
        if (delimiter === ']') break;
        if (delimiter !== ',') __jsonRejected();
        this.space();
      }
      return Object.freeze({ tag: 'list', value: Object.freeze(items) });
    }
    readRecord(depth) {
      this.index += 1;
      this.space();
      const fields = new Map();
      if (this.source[this.index] === '}') {
        this.index += 1;
        return Object.freeze({ tag: 'record', value: Object.freeze([]) });
      }
      while (true) {
        if (this.source[this.index] !== '"') __jsonRejected();
        const key = this.readString();
        if (fields.has(key)) __jsonRejected();
        this.space();
        if (this.source[this.index++] !== ':') __jsonRejected();
        this.space();
        fields.set(key, this.readValue(depth + 1));
        this.meter.collection(fields.size);
        this.space();
        const delimiter = this.source[this.index++];
        if (delimiter === '}') break;
        if (delimiter !== ',') __jsonRejected();
        this.space();
      }
      const entries = [...fields.entries()]
        .sort(([left], [right]) => __compare(left, right))
        .map(([key, value]) => Object.freeze({ key, value }));
      return Object.freeze({ tag: 'record', value: Object.freeze(entries) });
    }
    readNumber() {
      this.meter.check();
      const remainder = this.source.slice(this.index);
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?/u.exec(remainder);
      if (!match) __jsonRejected();
      const token = match[0];
      this.meter.check();
      const next = remainder[token.length];
      if (next === 'e' || next === 'E' || next === '.' || /[0-9A-Za-z_+-]/u.test(next || '')) __jsonRejected();
      if (token === '-0') __jsonRejected();
      this.index += token.length;
      this.meter.text(token);
      return token.includes('.')
        ? Object.freeze({ tag: 'decimal', value: token })
        : Object.freeze({ tag: 'integer', value: token });
    }
  }
  const __parseKernText = (source, meter) => new __JsonReader(source, meter).read();
  const __writeValue = (value, meter, depth) => {
    meter.step();
    if (depth > meter.limits.maxDepth) throw new __Fault('runtime-limit-exceeded', 'execution');
    if (value.tag === 'null') return 'null';
    if (value.tag === 'boolean') return value.value ? 'true' : 'false';
    if (value.tag === 'text') return __quote(value.value);
    if (value.tag === 'integer' || value.tag === 'decimal') return value.value;
    if (value.tag === 'list') {
      meter.collection(value.value.length);
      return '[' + value.value.map((item) => __writeValue(item, meter, depth + 1)).join(',') + ']';
    }
    meter.collection(value.value.length);
    return '{' + value.value.map((entry) => __quote(entry.key) + ':' + __writeValue(entry.value, meter, depth + 1)).join(',') + '}';
  };
  const __stringifyKernValue = (value, meter) => meter.text(__writeValue(value, meter, 1));
  const __encodeValue = (value, check = () => {}) => {
    check();
    if (value.tag === 'null') return 'null';
    if (value.tag === 'boolean') return value.value ? 'true' : 'false';
    if (value.tag === 'text') return __quote(value.value, check);
    if (value.tag === 'integer' || value.tag === 'decimal') return value.value;
    if (value.tag === 'list') return '[' + value.value.map((item) => __encodeValue(item, check)).join(',') + ']';
    return '{' + value.value.map((entry) => __quote(entry.key, check) + ':' + __encodeValue(entry.value, check)).join(',') + '}';
  };
  const __member = (object, optional, property) => {
    if (object.tag === 'null' && optional) return Object.freeze({ tag: 'null' });
    if (object.tag !== 'record') throw new __Fault('unsupported-runtime-input', 'execution');
    const entry = object.value.find((item) => item.key === property);
    if (entry !== undefined) return entry.value;
    if (optional) return Object.freeze({ tag: 'null' });
    throw new __Fault('unsupported-runtime-input', 'execution');
  };
`;
