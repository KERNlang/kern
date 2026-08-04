import type {
  InternalRuntimeDiagnostic,
  InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeLimits,
  InternalRuntimeEvent,
  InternalRuntimeSlot,
  InternalRuntimeValue,
} from '../src/runtime-envelope/types.js';
import type {
  KernRuntimeHandlerDiagnostic,
  KernRuntimeHandlerEnvelope,
  KernRuntimeHandlerEvent,
  KernRuntimeHandlerLimits,
  KernRuntimeHandlerSlot,
  KernRuntimeHandlerValue,
} from '../src/runtime-handler.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type Assert<Condition extends true> = Condition;

type _LimitsParity = Assert<Equal<KernRuntimeHandlerLimits, InternalRuntimeEnvelopeLimits>>;
type _ValueParity = Assert<Equal<KernRuntimeHandlerValue, InternalRuntimeValue>>;
type _SlotParity = Assert<Equal<KernRuntimeHandlerSlot, InternalRuntimeSlot>>;
type _EventParity = Assert<Equal<KernRuntimeHandlerEvent, InternalRuntimeEvent>>;
type _DiagnosticParity = Assert<Equal<KernRuntimeHandlerDiagnostic, InternalRuntimeDiagnostic>>;
type _EnvelopeParity = Assert<
  Equal<Omit<KernRuntimeHandlerEnvelope, 'format'>, Omit<InternalRuntimeEnvelope, 'format'>>
>;

describe('runtime contract v1 public/internal parity', () => {
  test('keeps distinct wire identities while every observable payload shape is exact', () => {
    const publicFormat: KernRuntimeHandlerEnvelope['format'] = 'kern.runtime.handler.v1';
    const internalFormat: InternalRuntimeEnvelope['format'] = 'kern.runtime.internal.r0';
    expect(publicFormat).not.toBe(internalFormat);
  });
});
