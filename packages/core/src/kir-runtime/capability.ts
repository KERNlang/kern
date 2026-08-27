import type { KernKirCapabilityCall, KernKirExecutionOptions, KernKirFault, KernKirSlot } from './contracts.js';

export async function invokeCapability(
  invoke: NonNullable<KernKirExecutionOptions['invoke']>,
  call: KernKirCapabilityCall,
  interruptedFault: () => KernKirFault,
): Promise<unknown> {
  let rejectInterrupted: ((error: KernKirFault) => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  const onAbort = (): void => rejectInterrupted?.(interruptedFault());
  call.signal.addEventListener('abort', onAbort, { once: true });
  if (call.signal.aborted) onAbort();
  try {
    if (call.signal.aborted) return await interrupted;
    const pending: PromiseLike<KernKirSlot> | KernKirSlot = invoke(call);
    return await Promise.race([Promise.resolve(pending), interrupted]);
  } finally {
    call.signal.removeEventListener('abort', onAbort);
  }
}
