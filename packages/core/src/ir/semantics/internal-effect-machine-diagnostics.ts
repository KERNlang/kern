export type InternalEffectMachineDiagnosticEvent =
  | {
      readonly argumentCount: number;
      readonly cacheKeyLength: number | null;
      readonly kind: 'helper-prepare';
      readonly name: string;
    }
  | {
      readonly hit: boolean;
      readonly kind: 'helper-cache';
      readonly name: string;
    }
  | {
      readonly kind: 'helper-execute';
      readonly name: string;
    }
  | {
      readonly dependency: string;
      readonly kind: 'helper-parent-restart';
      readonly parent: string;
      readonly rolledBackIterations: number;
    }
  | {
      readonly dependency: string;
      readonly kind: 'helper-frame-suspend';
      readonly parent: string;
    }
  | {
      readonly kind: 'loop-iteration';
      readonly nodeType: 'each' | 'for' | 'lambda' | 'while';
    };

export type InternalEffectMachineObserver = (event: InternalEffectMachineDiagnosticEvent) => void;

export function emitInternalEffectMachineDiagnostic(
  observer: InternalEffectMachineObserver | undefined,
  event: InternalEffectMachineDiagnosticEvent,
): void {
  if (observer === undefined) return;
  try {
    observer(Object.freeze(event));
  } catch {
    // Diagnostics are observational. A broken observer cannot change execution.
  }
}
