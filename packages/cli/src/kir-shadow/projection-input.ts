import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import {
  projectKernModules,
  type VerifiedKernProjection,
  verifyKernProjection,
} from '@kernlang/core/frontend-projection';
import { KIR_SHADOW_SOURCE_MAX_BYTES } from './limits.js';
import type { KirShadowEntry } from './types.js';
import { KirShadowAdmissionError, KirShadowUnavailableError } from './types.js';

interface LoadedProjection {
  readonly artifactSha256: string;
  readonly verified: VerifiedKernProjection;
}

function readSource(file: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, 'r');
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > KIR_SHADOW_SOURCE_MAX_BYTES) {
      throw new KirShadowAdmissionError('input must be a bounded regular .kern file');
    }
    const bytes = Buffer.allocUnsafe(KIR_SHADOW_SOURCE_MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > KIR_SHADOW_SOURCE_MAX_BYTES) {
      throw new KirShadowAdmissionError('input must be a bounded regular .kern file');
    }
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    } catch {
      throw new KirShadowAdmissionError('input must be valid UTF-8');
    }
    if (/^[\t ]*(?:use|from)\s+/mu.test(source)) throw new KirShadowAdmissionError('imports are not admitted');
    return source;
  } catch (error) {
    if (error instanceof KirShadowAdmissionError) throw error;
    throw new KirShadowAdmissionError('input must be a readable .kern file');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function propertyText(node: Record<string, unknown>, key: string): string | undefined {
  const properties = node.properties;
  if (!Array.isArray(properties)) return undefined;
  const property = properties.find(
    (item) => item && typeof item === 'object' && (item as Record<string, unknown>).key === key,
  ) as Record<string, unknown> | undefined;
  const value = property?.value as Record<string, unknown> | undefined;
  return value?.tag === 'text' && typeof value.value === 'string' ? value.value : undefined;
}

function containsKind(node: Record<string, unknown>, kind: string): boolean {
  if (node.kind === kind) return true;
  return Array.isArray(node.children)
    ? node.children.some(
        (child) => child && typeof child === 'object' && containsKind(child as Record<string, unknown>, kind),
      )
    : false;
}

function assertAdmission(projection: VerifiedKernProjection, entry: KirShadowEntry): void {
  if (projection.artifact.modules.length !== 1) throw new KirShadowAdmissionError('imports are not admitted');
  const module = projection.artifact.modules[0];
  if (module.id !== entry.moduleId || module.imports.length !== 0)
    throw new KirShadowAdmissionError('imports are not admitted');
  if (module.roots.some((candidate) => containsKind(candidate as unknown as Record<string, unknown>, 'capability'))) {
    throw new KirShadowAdmissionError('capabilities are not admitted');
  }
  const root = module.roots.find(
    (candidate) =>
      candidate.kind === 'fn' &&
      propertyText(candidate as unknown as Record<string, unknown>, 'name') === entry.handlerName,
  );
  if (!root) throw new KirShadowAdmissionError('entry handler is not admitted');
  const children = (root.children ?? []) as unknown as readonly Record<string, unknown>[];
  if (children.some((child) => child.kind === 'param'))
    throw new KirShadowAdmissionError('handler parameters are not admitted');
  const handlers = children.filter((child) => child.kind === 'handler' && propertyText(child, 'lang') === 'kern');
  if (handlers.length !== 1) throw new KirShadowAdmissionError('entry must have one KERN handler');
}

export async function projectShadowInput(file: string, entry: KirShadowEntry): Promise<LoadedProjection> {
  const request = { modules: [{ moduleId: entry.moduleId, source: readSource(file) }] };
  const projected = await projectKernModules(request);
  if (projected.status !== 'projected') {
    throw new KirShadowUnavailableError(projected.diagnostics[0]?.code ?? 'projection-unavailable');
  }
  let verified: VerifiedKernProjection;
  try {
    verified = await verifyKernProjection(request, projected);
  } catch {
    throw new KirShadowUnavailableError('projection-verification-failed');
  }
  assertAdmission(verified, entry);
  return { artifactSha256: projected.receipt.artifactDigest as string, verified };
}
