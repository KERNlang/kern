/** Controlled program-runner failure: parse/setup/runtime abstention, never a raw stack. */
export class KernRunnerError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = 'KernRunnerError';
    this.exitCode = exitCode;
  }
}
