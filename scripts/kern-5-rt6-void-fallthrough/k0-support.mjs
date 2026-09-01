import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { projectKernModules } from '../../packages/core/dist/frontend-projection.js';
import { LINKED_KIR_TYPE_ADMISSION } from '../../packages/core/dist/kir-runtime/linked-kir-program/contracts.js';
import { RuntimeMeter } from '../../packages/core/dist/kir-runtime/inspect.js';
import { linkVerifiedKernKirProgramOrThrow } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import {
  ENTRY,
  LIMITS,
  admission,
  compileJavaScript,
  compilePython,
  moduleSource,
  project,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';

export { LINKED_KIR_TYPE_ADMISSION };

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

// The linker's rejection code is closed, so a suite that only asserts the code cannot tell which
// gate fired. The fault message carries the label; pin that.
export async function assertLinkLabel(source, label) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', `${label} must project so the negative is a link decision`);
  for (const leg of ['rt1', 'javascript', 'python']) {
    assert.equal(row[leg], 'handler-entry-unsupported', `${leg} must reject ${label} under the closed code`);
  }
  let thrown;
  try {
    linkVerifiedKernKirProgramOrThrow(row.verified, ENTRY, new RuntimeMeter(LIMITS));
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown !== undefined, `${label} must throw at link`);
  assert.ok(
    thrown.message.includes(label),
    `expected the ${label} gate to fire, but the linker reported: ${thrown.message}`,
  );
  return thrown.message;
}

// indexOf returns -1 on a missing marker, which silently turns a slice into an empty string and a
// tail assertion into a tautology. Every extraction goes through here instead.
export function between(source, start, end, label) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${label}: start marker ${JSON.stringify(start)} is absent`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `${label}: end marker ${JSON.stringify(end)} is absent after the start marker`);
  const slice = source.slice(from, to);
  assert.ok(slice.length > 0, `${label}: extracted an empty region`);
  return slice;
}

export function lastBetween(source, start, end, label) {
  const from = source.lastIndexOf(start);
  assert.ok(from >= 0, `${label}: start marker ${JSON.stringify(start)} is absent`);
  return between(source.slice(from), start, end, label);
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
