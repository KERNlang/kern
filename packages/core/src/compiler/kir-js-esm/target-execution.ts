export const TARGET_EXECUTION_SOURCE = `
  const __ownData = (value, key) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    try {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && descriptor.enumerable && 'value' in descriptor ? descriptor.value : undefined;
    } catch {
      return undefined;
    }
  };
  const __createDeadline = (input) => {
    const timeout = __ownData(__ownData(input, 'control'), 'timeoutMs');
    const accepted = Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 2147483647 ? timeout : null;
    const expiresAt = accepted === null ? null : performance.now() + accepted;
    return Object.freeze({
      remainingMs: () => expiresAt === null ? null : Math.max(0, expiresAt - performance.now()),
      check: () => {
        if (expiresAt !== null && performance.now() >= expiresAt) throw new __Fault('execution-timeout', 'execution');
      },
    });
  };
  const __requestIdFrom = (value) => {
    try {
      const record = __plain(value);
      return typeof record.requestId === 'string' ? record.requestId : null;
    } catch {
      return null;
    }
  };
  const __inspectOptions = (value) => {
    if (value === undefined) return Object.freeze({});
    const record = __plain(value);
    if (Object.keys(record).some((key) => key !== 'invoke' && key !== 'signal')) __bad();
    if (record.invoke !== undefined && typeof record.invoke !== 'function') __bad();
    if (record.signal !== undefined && !(record.signal instanceof AbortSignal)) __bad();
    return Object.freeze({
      ...(record.invoke === undefined ? {} : { invoke: record.invoke }),
      ...(record.signal === undefined ? {} : { signal: record.signal }),
    });
  };
  const __matches = (value, type) => {
    if (type.kind !== 'list') return value.tag === type.kind;
    return value.tag === 'list' && value.value.every((item) => item.tag === type.element);
  };
  const __invokeCapability = async (invoke, call, interruptedFault) => {
    let rejectInterrupted;
    const interrupted = new Promise((_resolve, reject) => { rejectInterrupted = reject; });
    const onAbort = () => rejectInterrupted(interruptedFault());
    call.signal.addEventListener('abort', onAbort, { once: true });
    if (call.signal.aborted) onAbort();
    try {
      if (call.signal.aborted) return await interrupted;
      const pending = invoke(call);
      return await Promise.race([Promise.resolve(pending), interrupted]);
    } finally {
      call.signal.removeEventListener('abort', onAbort);
    }
  };
  const __slotText = (slot, check) => slot.presence === 'absent'
    ? '{"presence":"absent"}'
    : '{"presence":"value","value":' + __encodeValue(slot.value, check) + '}';
  const __successBytes = (requestId, events, result, check) => {
    const eventText = events.map((event) => {
      check();
      return event.op === 'stdout'
        ? '{"op":"stdout","text":' + __quote(event.text, check) + '}'
        : '{"input":' + __slotText(event.input, check) + ',"namespace":' + __quote(event.namespace, check)
          + ',"op":"capability","operation":' + __quote(event.operation, check) + ',"result":'
          + __slotText(event.result, check) + '}';
    });
    const text = '{"completion":{"kind":"return"},"diagnostics":[],"events":[' + eventText.join(',')
      + '],"format":"kern.runtime.kir.v1","outcome":"success","requestId":' + __quote(requestId, check)
      + ',"result":' + __slotText(result, check) + '}';
    return __utf8(text, check);
  };
  const __failureEnvelope = (requestId, error, events) => {
    const cause = error instanceof __Fault ? error : new __Fault('handler-link-error', 'link');
    return Object.freeze({
      completion: Object.freeze({ kind: 'error' }),
      diagnostics: Object.freeze([Object.freeze({ category: 'runtime', code: cause.code, phase: cause.phase })]),
      events: Object.freeze([...events]),
      format: __runtimeFormat,
      outcome: 'failure',
      requestId,
      result: Object.freeze({ presence: 'absent' }),
    });
  };
  const __boolOperand = (operand) => {
    if (operand.tag !== 'boolean') throw new __Fault('unsupported-runtime-input', 'execution');
    return operand;
  };
  const __intOperand = (operand) => {
    if (operand.tag !== 'integer') throw new __Fault('unsupported-runtime-input', 'execution');
    return BigInt(operand.value);
  };
  const __boolValue = (flag) => Object.freeze({ tag: 'boolean', value: flag });
  const __and = (left, right) => __boolOperand(left).value === false ? left : __boolOperand(right());
  const __or = (left, right) => __boolOperand(left).value === true ? left : __boolOperand(right());
  const __sameOperands = (left, right) => {
    if (left.tag !== right.tag) throw new __Fault('unsupported-runtime-input', 'execution');
    if (left.tag === 'boolean') return left.value === right.value;
    if (left.tag === 'integer') return BigInt(left.value) === BigInt(right.value);
    throw new __Fault('unsupported-runtime-input', 'execution');
  };
  const __eq = (left, right) => __boolValue(__sameOperands(left, right));
  const __ne = (left, right) => __boolValue(!__sameOperands(left, right));
  const __lt = (left, right) => __boolValue(__intOperand(left) < __intOperand(right));
  const __le = (left, right) => __boolValue(__intOperand(left) <= __intOperand(right));
  const __gt = (left, right) => __boolValue(__intOperand(left) > __intOperand(right));
  const __ge = (left, right) => __boolValue(__intOperand(left) >= __intOperand(right));
  const __chars = (points) => {
    const chunks = [];
    for (let index = 0; index < points.length; index += 8192) {
      chunks.push(String.fromCodePoint(...points.slice(index, index + 8192)));
    }
    return chunks.join('');
  };
`;
