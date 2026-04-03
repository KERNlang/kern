/**
 * Core Language Codegen — Python generation dispatcher for KERN's type system.
 *
 * This is the thin dispatcher that delegates to modular generators.
 * Public API: generatePythonCoreNode (switch on node.type)
 */

import type { IRNode } from '@kernlang/core';

// Core generators (type, interface, fn, machine, error, config, store, test, event, import, const)
import {
  generateType,
  generateInterface,
  generateFunction,
  generateMachine,
  generateError,
  generateConfig,
  generateStore,
  generateTest,
  generateEvent,
  generateImport,
  generateConst,
} from './generators/core.js';

// Ground layer generators (derive, transform, action, guard, assume, invariant, each, collect, branch, resolve, expect, recover)
import {
  setDispatcher,
  generateDerive,
  generateTransform,
  generateAction,
  generateGuard,
  generateAssume,
  generateInvariant,
  generateEach,
  generateCollect,
  generateBranch,
  generateResolve,
  generateExpect,
  generateRecover,
} from './generators/ground.js';

// Data layer generators (model, repository, cache, dependency, service, union)
import {
  generatePythonModel,
  generatePythonRepository,
  generatePythonCache,
  generatePythonDependency,
  generatePythonService,
  generatePythonUnion,
} from './generators/data.js';

// Infra generators (job, storage, email)
import {
  generatePythonJob,
  generatePythonStorage,
  generatePythonEmail,
} from './generators/infra.js';

// Re-export helpers and annotation emitters for external consumers
export { p, kids, firstChild, emitPyReasonAnnotations, emitPyLowConfidenceTodo } from './codegen-helpers.js';

// Re-export individual generators so existing deep imports keep working
export {
  generateType,
  generateInterface,
  generateFunction,
  generateMachine,
  generateError,
  generateConfig,
  generateStore,
  generateTest,
  generateEvent,
  generateImport,
  generateConst,
} from './generators/core.js';

export {
  generateDerive,
  generateTransform,
  generateAction,
  generateGuard,
  generateAssume,
  generateInvariant,
  generateEach,
  generateCollect,
  generateBranch,
  generateResolve,
  generateExpect,
  generateRecover,
} from './generators/ground.js';

export {
  generatePythonModel,
  generatePythonRepository,
  generatePythonCache,
  generatePythonDependency,
  generatePythonService,
  generatePythonUnion,
  formatPythonDefault,
  mapColumnToPython,
} from './generators/data.js';

export {
  generatePythonJob,
  generatePythonStorage,
  generatePythonEmail,
} from './generators/infra.js';

// ── Dispatcher ───────────────────────────────────────────────────────────

/** Generate Python for any core language node. Returns string lines. */
export function generatePythonCoreNode(node: IRNode): string[] {
  switch (node.type) {
    case 'type': return generateType(node);
    case 'interface': return generateInterface(node);
    case 'fn': return generateFunction(node);
    case 'machine': return generateMachine(node);
    case 'error': return generateError(node);
    case 'config': return generateConfig(node);
    case 'store': return generateStore(node);
    case 'test': return generateTest(node);
    case 'event': return generateEvent(node);
    case 'import': return generateImport(node);
    case 'const': return generateConst(node);
    // Data layer
    case 'model': return generatePythonModel(node);
    case 'repository': return generatePythonRepository(node);
    case 'cache': return generatePythonCache(node);
    case 'dependency': return generatePythonDependency(node);
    case 'service': return generatePythonService(node);
    case 'union': return generatePythonUnion(node);
    // Backend infrastructure
    case 'job': return generatePythonJob(node);
    case 'storage': return generatePythonStorage(node);
    case 'email': return generatePythonEmail(node);
    // Ground layer
    case 'derive': return generateDerive(node);
    case 'transform': return generateTransform(node);
    case 'action': return generateAction(node);
    case 'guard': return generateGuard(node);
    case 'assume': return generateAssume(node);
    case 'invariant': return generateInvariant(node);
    case 'each': return generateEach(node);
    case 'collect': return generateCollect(node);
    case 'branch': return generateBranch(node);
    case 'resolve': return generateResolve(node);
    case 'expect': return generateExpect(node);
    case 'recover': return generateRecover(node);
    default: return [];
  }
}

// Wire up the dispatcher for recursive ground-layer nodes (each, branch)
setDispatcher(generatePythonCoreNode);
