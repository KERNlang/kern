import {
  KERN_KIR_RUNTIME_FORMAT,
  type KernKirEnvelope,
  type KernKirEvent,
  KernKirFault,
  type KernKirSlot,
} from './contracts.js';
import { utf8Bytes } from './inspect.js';
import { encodeKernJson, quoteKernJsonString } from './json.js';

function slotText(slot: KernKirSlot, check: () => void): string {
  if (slot.presence === 'absent') return '{"presence":"absent"}';
  return `{"presence":"value","value":${encodeKernJson(slot.value, check)}}`;
}

export function successEnvelopeBytes(
  requestId: string,
  events: readonly KernKirEvent[],
  result: KernKirSlot,
  check: () => void,
): number {
  const eventText = events.map((event) => {
    check();
    return event.op === 'stdout'
      ? `{"op":"stdout","text":${quoteKernJsonString(event.text, check)}}`
      : `{"input":${slotText(event.input, check)},"namespace":${quoteKernJsonString(event.namespace, check)},"op":"capability","operation":${quoteKernJsonString(event.operation, check)},"result":${slotText(event.result, check)}}`;
  });
  return utf8Bytes(
    `{"completion":{"kind":"return"},"diagnostics":[],"events":[${eventText.join(',')}],"format":"${KERN_KIR_RUNTIME_FORMAT}","outcome":"success","requestId":${quoteKernJsonString(requestId, check)},"result":${slotText(result, check)}}`,
    check,
  );
}

export function failureEnvelope(
  requestId: string | null,
  error: unknown,
  committedEvents: readonly KernKirEvent[],
): KernKirEnvelope {
  const cause =
    error instanceof KernKirFault
      ? error
      : new KernKirFault('handler-link-error', 'link', 'runtime owner failed closed');
  return Object.freeze({
    completion: Object.freeze({ kind: 'error' }),
    diagnostics: Object.freeze([Object.freeze({ category: 'runtime' as const, code: cause.code, phase: cause.phase })]),
    events: Object.freeze([...committedEvents]),
    format: KERN_KIR_RUNTIME_FORMAT,
    outcome: 'failure',
    requestId,
    result: Object.freeze({ presence: 'absent' }),
  });
}
