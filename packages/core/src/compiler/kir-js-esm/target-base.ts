export const TARGET_BASE_SOURCE = String.raw`
  const __runtimeFormat = 'kern.runtime.kir.v1';
  class __Fault extends Error {
    constructor(code, phase) {
      super(code);
      this.code = code;
      this.phase = phase;
    }
  }
  const __bad = () => { throw new __Fault('invalid-handler-arguments', 'link'); };
  const __plain = (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) __bad();
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) __bad();
      const output = Object.create(null);
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') __bad();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) __bad();
        output[key] = descriptor.value;
      }
      return output;
    } catch (error) {
      if (error instanceof __Fault) throw error;
      __bad();
    }
  };
  const __exact = (record, keys) => {
    const actual = Object.keys(record).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) __bad();
  };
  const __dense = (value) => {
    if (!Array.isArray(value)) __bad();
    try {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) __bad();
      return Array.from(value, (_item, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) __bad();
        return descriptor.value;
      });
    } catch (error) {
      if (error instanceof __Fault) throw error;
      __bad();
    }
  };
  const __utf8 = (value, check = () => {}) => {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      if ((index & 1023) === 0) check();
      const unit = value.charCodeAt(index);
      if (unit <= 0x7f) bytes += 1;
      else if (unit <= 0x7ff) bytes += 2;
      else if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = value.charCodeAt(index + 1);
        if (!Number.isFinite(low) || low < 0xdc00 || low > 0xdfff) __bad();
        index += 1;
        bytes += 4;
      } else {
        if (unit >= 0xdc00 && unit <= 0xdfff) __bad();
        bytes += 3;
      }
    }
    return bytes;
  };
  class __Meter {
    constructor(limits, check = () => {}) {
      this.limits = limits;
      this.checkInterruption = check;
      this.steps = 0;
    }
    check() { this.checkInterruption(); }
    step(amount = 1) {
      this.check();
      this.steps += amount;
      if (!Number.isSafeInteger(this.steps) || this.steps > this.limits.maxSteps) {
        throw new __Fault('runtime-limit-exceeded', 'execution');
      }
    }
    text(value) {
      this.check();
      if (__utf8(value, this.checkInterruption) > this.limits.maxStringBytes) {
        throw new __Fault('runtime-limit-exceeded', 'execution');
      }
      return value;
    }
    collection(length) {
      this.check();
      if (length > this.limits.maxCollectionLength) throw new __Fault('runtime-limit-exceeded', 'execution');
    }
  }
  const __requiredText = (value, meter) => {
    if (typeof value !== 'string' || value.length === 0) __bad();
    return meter.text(value);
  };
  const __positive = (value) => {
    if (!Number.isSafeInteger(value) || value < 1) __bad();
    return value;
  };
  const __compare = (left, right) => {
    const a = Array.from(left, (item) => item.codePointAt(0));
    const b = Array.from(right, (item) => item.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
  };
  const __integer = /^(?:0|-?[1-9][0-9]*)$/u;
  const __decimal = /^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u;
  const __inspectValue = (value, meter, depth = 1) => {
    meter.step();
    if (depth > meter.limits.maxDepth) throw new __Fault('runtime-limit-exceeded', 'execution');
    const record = __plain(value);
    if (typeof record.tag !== 'string') __bad();
    if (record.tag === 'null') {
      __exact(record, ['tag']);
      return Object.freeze({ tag: 'null' });
    }
    if (record.tag === 'boolean') {
      __exact(record, ['tag', 'value']);
      if (typeof record.value !== 'boolean') __bad();
      return Object.freeze({ tag: 'boolean', value: record.value });
    }
    if (record.tag === 'text') {
      __exact(record, ['tag', 'value']);
      if (typeof record.value !== 'string') __bad();
      return Object.freeze({ tag: 'text', value: meter.text(record.value) });
    }
    if (record.tag === 'integer' || record.tag === 'decimal') {
      __exact(record, ['tag', 'value']);
      if (typeof record.value !== 'string' || !(record.tag === 'integer' ? __integer : __decimal).test(record.value)) __bad();
      meter.text(record.value);
      return Object.freeze({ tag: record.tag, value: record.value });
    }
    if (record.tag === 'list') {
      __exact(record, ['tag', 'value']);
      const items = __dense(record.value);
      meter.collection(items.length);
      return Object.freeze({
        tag: 'list',
        value: Object.freeze(items.map((item) => __inspectValue(item, meter, depth + 1))),
      });
    }
    if (record.tag === 'record') {
      __exact(record, ['tag', 'value']);
      const entries = __dense(record.value);
      meter.collection(entries.length);
      let previous;
      const inspected = entries.map((entry) => {
        const item = __plain(entry);
        __exact(item, ['key', 'value']);
        const key = __requiredText(item.key, meter);
        if (previous !== undefined && __compare(previous, key) >= 0) __bad();
        previous = key;
        return Object.freeze({ key, value: __inspectValue(item.value, meter, depth + 1) });
      });
      return Object.freeze({ tag: 'record', value: Object.freeze(inspected) });
    }
    __bad();
  };
  const __inspectSlot = (value, meter) => {
    const record = __plain(value);
    if (record.presence === 'absent') {
      __exact(record, ['presence']);
      return Object.freeze({ presence: 'absent' });
    }
    if (record.presence === 'value') {
      __exact(record, ['presence', 'value']);
      return Object.freeze({ presence: 'value', value: __inspectValue(record.value, meter) });
    }
    __bad();
  };
  const __quote = (value, check = () => {}) => {
    let output = '"';
    for (let index = 0; index < value.length; index += 1) {
      if ((index & 1023) === 0) check();
      const character = value[index];
      const code = value.charCodeAt(index);
      if (character === '"' || character === '\\') output += '\\' + character;
      else if (character === '\b') output += '\\b';
      else if (character === '\f') output += '\\f';
      else if (character === '\n') output += '\\n';
      else if (character === '\r') output += '\\r';
      else if (character === '\t') output += '\\t';
      else if (code < 0x20) output += '\\u' + code.toString(16).padStart(4, '0');
      else output += character;
    }
    return output + '"';
  };
  const __dataText = (value) => {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return __quote(value);
    if (Array.isArray(value)) return '[' + value.map(__dataText).join(',') + ']';
    return '{' + Object.keys(value).map((key) => __quote(key) + ':' + __dataText(value[key])).join(',') + '}';
  };
  const __inspectRequest = (value, check) => {
    const record = __plain(value);
    __exact(record, ['format', 'requestId', 'entry', 'arguments', 'control', 'limits']);
    if (record.format !== __runtimeFormat) __bad();
    const limitInput = __plain(record.limits);
    const limitKeys = ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxSteps', 'maxStringBytes'];
    __exact(limitInput, limitKeys);
    const limits = Object.freeze({
      maxBytes: __positive(limitInput.maxBytes),
      maxCollectionLength: __positive(limitInput.maxCollectionLength),
      maxDepth: __positive(limitInput.maxDepth),
      maxDiagnostics: __positive(limitInput.maxDiagnostics),
      maxEvents: __positive(limitInput.maxEvents),
      maxSteps: __positive(limitInput.maxSteps),
      maxStringBytes: __positive(limitInput.maxStringBytes),
    });
    const meter = new __Meter(limits, check);
    const requestId = __requiredText(record.requestId, meter);
    const entryInput = __plain(record.entry);
    __exact(entryInput, ['moduleId', 'handlerName']);
    const moduleId = __requiredText(entryInput.moduleId, meter);
    const handlerName = __requiredText(entryInput.handlerName, meter);
    if (!moduleId.endsWith('.kern') || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(handlerName)) __bad();
    const controlInput = __plain(record.control);
    __exact(controlInput, ['preCancelled', 'timeoutMs']);
    if (typeof controlInput.preCancelled !== 'boolean') __bad();
    if (controlInput.timeoutMs !== null && (!Number.isSafeInteger(controlInput.timeoutMs) || controlInput.timeoutMs < 1 || controlInput.timeoutMs > 2147483647)) __bad();
    const argumentInput = __plain(record.arguments);
    const names = Object.keys(argumentInput).sort();
    meter.collection(names.length);
    const args = Object.create(null);
    for (const name of names) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) __bad();
      meter.text(name);
      args[name] = __inspectValue(argumentInput[name], meter);
    }
    const request = Object.freeze({
      format: __runtimeFormat,
      requestId,
      entry: Object.freeze({ moduleId, handlerName }),
      arguments: Object.freeze(args),
      control: Object.freeze({ preCancelled: controlInput.preCancelled, timeoutMs: controlInput.timeoutMs }),
      limits,
    });
    if (__utf8(__dataText(request)) > limits.maxBytes) throw new __Fault('runtime-limit-exceeded', 'execution');
    return { request, meter };
  };
`;
