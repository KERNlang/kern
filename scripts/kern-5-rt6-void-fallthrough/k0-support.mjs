import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { projectKernModules } from '../../packages/core/dist/frontend-projection.js';
import { ENTRY, compileJavaScript, compilePython, moduleSource, project } from '../kern-5-rt4-user-fn-call/k0-support.mjs';

export * from '../kern-5-rt4-user-fn-call/k0-support.mjs';

export function text(value) {
  return `print value="\\"${value}\\""`;
}

export function entryOf(body, { parameters = [], returns = 'void' } = {}) {
  return moduleSource([{ body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

// The one semantic case: an exported void handler that completes by falling through its last
// statement, having emitted two ordered stdout events.
export const VOID_FALLTHROUGH = entryOf([text('first'), text('second')]);

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function projectionStatus(source) {
  const result = await projectKernModules({ modules: [{ moduleId: ENTRY.moduleId, source }] });
  if (result.status !== 'projected') {
    return { diagnostics: [...new Set((result.diagnostics ?? []).map((item) => item.code))].sort(), status: 'rejected' };
  }
  return { status: 'projected' };
}

async function projectedRoot(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the probe fixture must project');
  return verified.artifact.modules[0].roots[0];
}

export async function returnsProperty(source) {
  const returns = (await projectedRoot(source)).properties.find((property) => property.key === 'returns');
  assert.ok(returns !== undefined, 'a projected fn must carry a returns property');
  return returns.value;
}

export async function lastStatementShape(source) {
  const handler = (await projectedRoot(source)).children.find((node) => node.kind === 'handler');
  const statement = handler.children.at(-1);
  return { keys: statement.properties.map((property) => property.key).sort(), kind: statement.kind };
}

// F5 is fatal on every return or parameter kind outside its own closed set, so no projection can
// reach the linker's type gates. Pinning the literals each gate compares against is what keeps the
// gates honest: widening `parameterType` to admit void, or keying the void return on anything but
// the word itself, moves this inventory.
export async function linkTypeGateLiterals() {
  const source = await readFile(new URL('../../packages/core/src/kir-runtime/linked-kir-program/link.ts', import.meta.url), 'utf8');
  const body = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `link.ts must declare ${name}`);
    const end = source.indexOf('\nfunction ', start + 1);
    assert.ok(end > start, `${name} must be followed by another function`);
    return source.slice(start, end);
  };
  const literals = (name) =>
    [...new Set([...body(name).matchAll(/(===|!==) '([a-z]+)'/gu)].map((match) => `${match[1]} ${match[2]}`))].sort();
  return { handlerReturnType: literals('handlerReturnType'), parameterType: literals('parameterType') };
}

export async function emittedArtifacts(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  return {
    javascript: Buffer.from(javascript.artifact.bytes).toString('utf8'),
    python: Buffer.from(python.artifact.bytes).toString('utf8'),
  };
}
