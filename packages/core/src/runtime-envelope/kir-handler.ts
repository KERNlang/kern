import { isPortableBindingName } from '../ir/semantics/portable-scalar-domain.js';
import { markRunnerMachineRootScope } from '../ir/semantics/runner-machine-scope.js';
import type { SemanticEnv } from '../ir/semantics/semantic-env.js';
import { decodeModuleKir } from '../kir-structural/module-canonical.js';
import { normalizeModuleId } from '../kir-structural/module-path.js';
import type { ModuleKirArtifact, ModuleKirCodecOptions } from '../kir-structural/module-types.js';
import { inflateStructuralKirNode } from '../kir-structural/runtime-inflate.js';
import {
  buildRunnerModuleScopes,
  collectRunnerClasses,
  collectRunnerFunctions,
  type RunnerLinkedScopeRecord,
  validateRunnerCallableNames,
} from '../runner-runtime-scope.js';
import {
  admitKernRuntimeHandlerSignature,
  inspectKernRuntimeHandlerSignature,
  type KernRuntimeHandlerSignature,
} from '../runtime-handler-contract.js';
import type { IRNode } from '../types.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
  type InternalRuntimeHandlerEntry,
} from './handler-entry.js';
import type { InternalRuntimeAsyncOptions } from './internal-engine.js';
import { internalRuntimeLinkFailure } from './normalize.js';
import {
  type InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeOptions,
} from './types.js';
import { validateInternalRuntimeLimits } from './value.js';

export interface InternalRuntimeKirHandlerIdentity {
  readonly handlerName: string;
  readonly moduleId: string;
}

export interface InternalRuntimeKirHandlerOptions extends InternalRuntimeEnvelopeOptions {
  readonly kirLimits: ModuleKirCodecOptions['limits'];
}

export interface InternalRuntimeKirLinkedHandlerEntry extends InternalRuntimeHandlerEntry {
  readonly identity: InternalRuntimeKirHandlerIdentity;
  readonly signature: KernRuntimeHandlerSignature;
}

type LinkCode = Extract<
  Parameters<typeof internalRuntimeLinkFailure>[0],
  'handler-entry-ambiguous' | 'handler-entry-not-found' | 'handler-entry-unsupported' | 'handler-link-error'
>;

class LinkFailure extends Error {
  constructor(readonly code: LinkCode) {
    super(code);
  }
}

function fail(code: LinkCode): never {
  throw new LinkFailure(code);
}

function requireEnabled(options: InternalRuntimeKirHandlerOptions | undefined): InternalRuntimeKirHandlerOptions {
  if (options?.enabled !== true) {
    throw new InternalRuntimeEnvelopeError('disabled', 'internal KIR runtime handler binding is default-off');
  }
  validateInternalRuntimeLimits(options.limits);
  return options;
}

function canonicalIdentity(
  identity: InternalRuntimeKirHandlerIdentity,
  maxStringBytes: number,
): InternalRuntimeKirHandlerIdentity {
  if (
    !identity ||
    !isPortableBindingName(identity.handlerName) ||
    new TextEncoder().encode(identity.handlerName).length > maxStringBytes
  ) {
    fail('handler-entry-unsupported');
  }
  if (typeof identity.moduleId !== 'string' || new TextEncoder().encode(identity.moduleId).length > maxStringBytes) {
    fail('handler-link-error');
  }
  const moduleId = normalizeModuleId(identity.moduleId, '$.identity.moduleId');
  return { handlerName: identity.handlerName, moduleId };
}

function documentRoot(roots: readonly IRNode[]): IRNode {
  return { type: 'document', children: [...roots] };
}

function linkedScopeRecords(artifact: ModuleKirArtifact): readonly RunnerLinkedScopeRecord[] {
  return artifact.modules.map((module) => {
    const roots = module.roots.map((root, index) =>
      inflateStructuralKirNode(root, `$.modules.${module.id}.roots[${index}]`),
    );
    const document = documentRoot(roots);
    const functions = collectRunnerFunctions(document);
    const classes = collectRunnerClasses(document);
    validateRunnerCallableNames(functions, classes);
    return {
      classes,
      exports: new Map(
        module.exports
          .filter((item) => item.source === null)
          .map((item) => [item.name, { kind: item.kind, sourceName: item.name }]),
      ),
      functions,
      imports: module.imports.flatMap((imported) =>
        imported.bindings.map((binding) => ({
          exportOnly: binding.reexport,
          importedName: binding.imported,
          localName: binding.local,
          targetPath: imported.source,
        })),
      ),
      path: module.id,
    };
  });
}

function linkedEntry(
  artifact: ModuleKirArtifact,
  identity: InternalRuntimeKirHandlerIdentity,
): InternalRuntimeKirLinkedHandlerEntry {
  const module = artifact.modules.find((candidate) => candidate.id === identity.moduleId);
  if (!module) fail('handler-entry-not-found');
  const roots = module.roots.map((root, index) =>
    inflateStructuralKirNode(root, `$.modules.${module.id}.roots[${index}]`),
  );
  const matches = roots.filter((node) => node.type === 'fn' && node.props?.name === identity.handlerName);
  if (matches.length === 0) {
    const wrongKind = roots.some((node) => node.type === 'class' && node.props?.name === identity.handlerName);
    fail(wrongKind ? 'handler-entry-unsupported' : 'handler-entry-not-found');
  }
  if (matches.length > 1) fail('handler-entry-ambiguous');
  const fn = matches[0] as IRNode;
  if (fn.props?.async === true || fn.props?.stream === true) fail('handler-entry-unsupported');
  const handlers = (fn.children ?? []).filter((node) => node.type === 'handler');
  if (handlers.length > 1) fail('handler-entry-ambiguous');
  const handler = handlers[0];
  if (handler?.props?.lang !== 'kern' || handler.props?.code !== undefined) fail('handler-entry-unsupported');
  const signature = inspectKernRuntimeHandlerSignature(fn);
  if (!signature || admitKernRuntimeHandlerSignature(signature) === null) fail('handler-entry-unsupported');

  const scopes = buildRunnerModuleScopes(linkedScopeRecords(artifact));
  const runnerScope = scopes.get(module.id);
  if (!runnerScope) fail('handler-link-error');
  runnerScope.functions.delete(identity.handlerName);
  markRunnerMachineRootScope(runnerScope);
  return {
    body: handler.children ?? [],
    identity,
    parameters: signature.parameters.map(({ name }) => name),
    runnerScope,
    signature,
  };
}

export function resolveInternalRuntimeKirHandler(
  bytes: Uint8Array,
  identity: InternalRuntimeKirHandlerIdentity,
  options?: InternalRuntimeKirHandlerOptions,
): InternalRuntimeKirLinkedHandlerEntry | InternalRuntimeEnvelope {
  const accepted = requireEnabled(options);
  try {
    const selected = canonicalIdentity(identity, accepted.limits.maxStringBytes);
    return linkedEntry(decodeModuleKir(bytes, accepted.kirLimits), selected);
  } catch (error) {
    return internalRuntimeLinkFailure(error instanceof LinkFailure ? error.code : 'handler-link-error');
  }
}

export function executeInternalRuntimeKirHandlerSync(
  bytes: Uint8Array,
  identity: InternalRuntimeKirHandlerIdentity,
  args: readonly unknown[],
  host: SemanticEnv,
  options?: InternalRuntimeKirHandlerOptions,
): InternalRuntimeEnvelope {
  const entry = resolveInternalRuntimeKirHandler(bytes, identity, options);
  return 'format' in entry ? entry : executeInternalRuntimeHandlerSync(entry, args, host, options);
}

export async function executeInternalRuntimeKirHandlerAsync(
  bytes: Uint8Array,
  identity: InternalRuntimeKirHandlerIdentity,
  args: readonly unknown[],
  host: SemanticEnv,
  options?: InternalRuntimeKirHandlerOptions,
  asyncOptions: InternalRuntimeAsyncOptions = {},
): Promise<InternalRuntimeEnvelope> {
  const entry = resolveInternalRuntimeKirHandler(bytes, identity, options);
  return 'format' in entry ? entry : executeInternalRuntimeHandlerAsync(entry, args, host, options, asyncOptions);
}
