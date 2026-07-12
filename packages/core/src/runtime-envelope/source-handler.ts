import type { AsyncReferenceRunnerOptions } from '../ir/semantics/async-reference-runner.js';
import type { SemanticEnv } from '../ir/semantics/index.js';
import { isPortableBindingName } from '../ir/semantics/portable-scalar.js';
import { parseDocumentWithDiagnostics } from '../parser.js';
import { validateSchema } from '../schema.js';
import type { IRNode } from '../types.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
  type InternalRuntimeHandlerEntry,
} from './handler-entry.js';
import { internalRuntimeLinkFailure } from './normalize.js';
import {
  type InternalRuntimeDiagnosticCode,
  type InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeError,
  type InternalRuntimeEnvelopeOptions,
} from './types.js';
import { validateInternalRuntimeLimits } from './value.js';

export interface InternalRuntimeSourceHandlerIdentity {
  readonly handlerName: string;
  readonly sourcePath: string;
}

export interface InternalRuntimeLinkedHandlerEntry extends InternalRuntimeHandlerEntry {
  readonly identity: InternalRuntimeSourceHandlerIdentity;
}

type LinkCode = Extract<
  InternalRuntimeDiagnosticCode,
  'handler-entry-ambiguous' | 'handler-entry-not-found' | 'handler-entry-unsupported' | 'handler-link-error'
>;

class LinkFailure extends Error {
  constructor(readonly code: LinkCode) {
    super(code);
  }
}

const textEncoder = new TextEncoder();

function fail(code: LinkCode): never {
  throw new LinkFailure(code);
}

function enabled(options: InternalRuntimeEnvelopeOptions | undefined): InternalRuntimeEnvelopeOptions {
  if (options?.enabled !== true) {
    throw new InternalRuntimeEnvelopeError('disabled', 'internal runtime source handler link is default-off');
  }
  validateInternalRuntimeLimits(options.limits);
  return options;
}

function canonicalSourcePath(path: unknown, maxBytes: number): string {
  if (typeof path !== 'string' || textEncoder.encode(path).length > maxBytes) fail('handler-link-error');
  if (path === '' || path.startsWith('/') || path.endsWith('/') || path.includes('\\') || path.includes('\0')) {
    fail('handler-link-error');
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) fail('handler-link-error');
  return path;
}

function portableName(value: unknown): string {
  if (!isPortableBindingName(value)) fail('handler-entry-unsupported');
  return value;
}

function trueProp(value: unknown): boolean {
  return value === true || value === 'true';
}

function legacyParameterNames(raw: string): readonly string[] {
  if (raw.trim() === '') return [];
  return raw.split(',').map((part) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)?$/.exec(part.trim());
    if (!match) fail('handler-entry-unsupported');
    return portableName(match[1]);
  });
}

function parameterNames(fn: IRNode): readonly string[] {
  const children = (fn.children ?? []).filter((node) => node.type === 'param');
  const legacy = typeof fn.props?.params === 'string' ? fn.props.params : '';
  if (children.length > 0 && legacy.trim() !== '') fail('handler-entry-unsupported');
  const names =
    children.length > 0
      ? children.map((parameter) => {
          if ((parameter.children ?? []).length > 0) fail('handler-entry-unsupported');
          if (parameter.props?.value !== undefined || parameter.props?.default !== undefined) {
            fail('handler-entry-unsupported');
          }
          if (trueProp(parameter.props?.optional) || trueProp(parameter.props?.variadic)) {
            fail('handler-entry-unsupported');
          }
          return portableName(parameter.props?.name);
        })
      : legacyParameterNames(legacy);
  if (new Set(names).size !== names.length) fail('handler-entry-unsupported');
  return names;
}

function linkedEntry(
  source: string,
  identity: InternalRuntimeSourceHandlerIdentity,
): InternalRuntimeLinkedHandlerEntry {
  const parsed = parseDocumentWithDiagnostics(source);
  if (parsed.partial || parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    fail('handler-link-error');
  }
  if (validateSchema(parsed.root).length > 0) fail('handler-link-error');
  const roots = parsed.root.type === 'document' ? (parsed.root.children ?? []) : [];
  if (roots.some((node) => node.type === 'use' || node.type === 'import' || node.type === 'export')) {
    fail('handler-entry-unsupported');
  }
  const matches = roots.filter((node) => node.type === 'fn' && node.props?.name === identity.handlerName);
  if (matches.length === 0) fail('handler-entry-not-found');
  if (matches.length > 1) fail('handler-entry-ambiguous');
  const fn = matches[0];
  if (trueProp(fn.props?.async) || trueProp(fn.props?.stream)) fail('handler-entry-unsupported');
  const handlers = (fn.children ?? []).filter((node) => node.type === 'handler');
  if (handlers.length > 1) fail('handler-entry-ambiguous');
  const handler = handlers[0];
  if (handler?.props?.lang !== 'kern' || handler.props?.code !== undefined) {
    fail('handler-entry-unsupported');
  }
  return { body: handler.children ?? [], identity, parameters: parameterNames(fn) };
}

export function resolveInternalRuntimeSourceHandler(
  source: string,
  identity: InternalRuntimeSourceHandlerIdentity,
  options?: InternalRuntimeEnvelopeOptions,
): InternalRuntimeLinkedHandlerEntry | InternalRuntimeEnvelope {
  const accepted = enabled(options);
  try {
    if (typeof source !== 'string' || textEncoder.encode(source).length > accepted.limits.maxBytes) {
      fail('handler-link-error');
    }
    const canonicalIdentity = {
      handlerName: portableName(identity?.handlerName),
      sourcePath: canonicalSourcePath(identity?.sourcePath, accepted.limits.maxStringBytes),
    };
    return linkedEntry(source, canonicalIdentity);
  } catch (error) {
    return internalRuntimeLinkFailure(error instanceof LinkFailure ? error.code : 'handler-link-error');
  }
}

export function executeInternalRuntimeSourceHandlerSync(
  source: string,
  identity: InternalRuntimeSourceHandlerIdentity,
  args: readonly unknown[],
  host: SemanticEnv,
  options?: InternalRuntimeEnvelopeOptions,
): InternalRuntimeEnvelope {
  const entry = resolveInternalRuntimeSourceHandler(source, identity, options);
  return 'format' in entry ? entry : executeInternalRuntimeHandlerSync(entry, args, host, options);
}

export async function executeInternalRuntimeSourceHandlerAsync(
  source: string,
  identity: InternalRuntimeSourceHandlerIdentity,
  args: readonly unknown[],
  host: SemanticEnv,
  options?: InternalRuntimeEnvelopeOptions,
  asyncOptions: AsyncReferenceRunnerOptions = {},
): Promise<InternalRuntimeEnvelope> {
  const entry = resolveInternalRuntimeSourceHandler(source, identity, options);
  return 'format' in entry ? entry : executeInternalRuntimeHandlerAsync(entry, args, host, options, asyncOptions);
}
