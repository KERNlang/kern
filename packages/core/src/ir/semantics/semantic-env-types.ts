import type { KernRunnerCapabilities, KernRunnerCapabilityContext } from '../../runner-capabilities.js';
import type { IRNode } from '../../types.js';

/** Runtime state shared by semantic evaluators without importing registry ownership. */
export interface SemanticEnv {
  /** Lexical storage; machine paths require constructor-owned composites. */
  bindings: Map<string, unknown>;
  intProvenance?: Set<string>;
  freshArrayBindings?: Set<string>;
  pushBuiltFreshArrayBindings?: Set<string>;
  capturedArrayBindings?: Set<string>;
  recordArrayFields?: Map<string, Set<string> | null>;
  runnerFunctions?: Map<string, RunnerFunctionBinding>;
  runnerClasses?: Map<string, RunnerClassBinding>;
  runnerCallStack?: string[];
  runnerCallCache?: Map<string, unknown>;
  runnerThis?: RunnerClassInstanceValue;
  runnerSuperClass?: string;
  runnerProtectedClassInstances?: WeakSet<RunnerClassInstanceValue>;
  capabilities?: KernRunnerCapabilities;
  capabilityContext?: KernRunnerCapabilityContext;
  intIndexCtx?: boolean;
  parent?: SemanticEnv;
  repeatableLoopBody?: boolean;
  seed: number;
  now: number;
}

export interface RunnerModuleScope {
  readonly functions: Map<string, RunnerFunctionBinding>;
  readonly classes: Map<string, RunnerClassBinding>;
}

export interface RunnerFunctionBinding {
  readonly name: string;
  readonly params: readonly string[];
  readonly returns?: unknown;
  readonly handler?: IRNode;
  readonly body: readonly IRNode[];
  readonly module?: RunnerModuleScope;
}

export interface RunnerClassFieldBinding {
  readonly name: string;
  readonly value?: unknown;
}

export interface RunnerClassMemberBinding {
  readonly name: string;
  readonly params: readonly string[];
  readonly handler?: IRNode;
  readonly body: readonly IRNode[];
  readonly ownerClass: string;
}

export interface RunnerClassBinding {
  readonly name: string;
  readonly extendsName?: string;
  readonly fields: readonly RunnerClassFieldBinding[];
  readonly constructor?: RunnerClassMemberBinding;
  readonly methods: ReadonlyMap<string, RunnerClassMemberBinding>;
  readonly getters: ReadonlyMap<string, RunnerClassMemberBinding>;
  readonly module?: RunnerModuleScope;
}

export interface RunnerClassInstanceValue {
  readonly __kernRunnerClassInstance: true;
  readonly className: string;
  readonly fields: Record<string, unknown>;
  readonly module?: RunnerModuleScope;
}
