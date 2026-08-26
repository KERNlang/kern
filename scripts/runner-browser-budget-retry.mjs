const CHROME_DEVTOOLS_PORT_TIMEOUT = 'timed out waiting for Chrome DevTools port:';

export class ChromeDevToolsStartupTimeoutError extends Error {
  constructor(detail) {
    super(`${CHROME_DEVTOOLS_PORT_TIMEOUT} ${detail}`);
    this.name = 'ChromeDevToolsStartupTimeoutError';
  }
}

export async function retryChromeDevToolsStartup(runAttempt, maxAttempts, onRetry = () => {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runAttempt(attempt);
    } catch (error) {
      const isFinalAttempt = attempt === maxAttempts;
      const isStartupTimeout = error instanceof ChromeDevToolsStartupTimeoutError;
      if (isFinalAttempt || !isStartupTimeout) throw error;
      await onRetry(error, attempt);
    }
  }
  throw new Error('Chrome DevTools startup retry exhausted without an attempt');
}
