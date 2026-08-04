import { AsyncLocalStorage } from 'node:async_hooks';

let observationActive = false;

export async function observeRuntimeTimers(run, whileInstalled = () => {}) {
  if (observationActive) throw new Error('runtime timer observation must be serialized');
  observationActive = true;
  const context = new AsyncLocalStorage();
  const token = Object.freeze({});
  const ownedTimers = new Set();
  const counts = { timerRegistrations: 0, timerClears: 0 };
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (...arguments_) => {
    const timer = originalSetTimeout(...arguments_);
    if (context.getStore() === token) {
      counts.timerRegistrations += 1;
      ownedTimers.add(timer);
    }
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    if (ownedTimers.delete(timer)) counts.timerClears += 1;
    return originalClearTimeout(timer);
  };
  try {
    await whileInstalled();
    const value = await context.run(token, run);
    return { counts, value };
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    context.disable();
    observationActive = false;
  }
}
