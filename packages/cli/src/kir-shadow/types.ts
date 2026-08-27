import type { KernKirEnvelope } from '@kernlang/core/runtime/kir';

export type KirShadowCommand = 'compile' | 'run';

export interface KirShadowEntry {
  readonly handlerName: string;
  readonly moduleId: string;
}

export interface KirShadowInvocation {
  readonly command: KirShadowCommand;
  readonly entry: KirShadowEntry;
  readonly file: string;
}

export type NormalizedEnvelope = Omit<KernKirEnvelope, 'requestId'>;

export class KirShadowAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KirShadowAdmissionError';
  }
}

export class KirShadowUnavailableError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'KirShadowUnavailableError';
    this.code = code;
  }
}
