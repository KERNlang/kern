/**
 * Core Language Codegen — Python generation dispatcher for KERN's type system.
 *
 * This is the thin dispatcher that delegates to modular generators.
 * Public API: generatePythonCoreNode (switch on node.type)
 */

import type { IRNode } from '@kernlang/core';

// Core generators (type, interface, fn, machine, error, config, store, test, event, import, const)
import {
  generateConfig,
  generateConst,
  generateError,
  generateEvent,
  generateFunction,
  generateImport,
  generateInterface,
  generateMachine,
  generateStore,
  generateTest,
  generateType,
} from './generators/core.js';
// Data layer generators (model, repository, cache, dependency, service, union)
import {
  generatePythonCache,
  generatePythonDependency,
  generatePythonModel,
  generatePythonRepository,
  generatePythonService,
  generatePythonUnion,
} from './generators/data.js';
// Ground layer generators (derive, transform, action, guard, assume, invariant, each, collect, branch, resolve, expect, recover)
import {
  generateAction,
  generateAssume,
  generateBranch,
  generateCollect,
  generateDerive,
  generateEach,
  generateExpect,
  generateGuard,
  generateInvariant,
  generateRecover,
  generateResolve,
  generateTransform,
  setDispatcher,
} from './generators/ground.js';

// Infra generators (job, storage, email)
import { generatePythonEmail, generatePythonJob, generatePythonStorage } from './generators/infra.js';

// Re-export helpers and annotation emitters for external consumers
export { emitPyLowConfidenceTodo, emitPyReasonAnnotations, firstChild, kids, p } from './codegen-helpers.js';

// Re-export individual generators so existing deep imports keep working
export {
  generateConfig,
  generateConst,
  generateError,
  generateEvent,
  generateFunction,
  generateImport,
  generateInterface,
  generateMachine,
  generateStore,
  generateTest,
  generateType,
} from './generators/core.js';
export {
  formatPythonDefault,
  generatePythonCache,
  generatePythonDependency,
  generatePythonModel,
  generatePythonRepository,
  generatePythonService,
  generatePythonUnion,
  mapColumnToPython,
} from './generators/data.js';
export {
  generateAction,
  generateAssume,
  generateBranch,
  generateCollect,
  generateDerive,
  generateEach,
  generateExpect,
  generateGuard,
  generateInvariant,
  generateRecover,
  generateResolve,
  generateTransform,
} from './generators/ground.js';

export {
  generatePythonEmail,
  generatePythonJob,
  generatePythonStorage,
} from './generators/infra.js';

// ── Dispatcher ───────────────────────────────────────────────────────────

/** Generate Python for any core language node. Returns string lines. */
export function generatePythonCoreNode(node: IRNode): string[] {
  switch (node.type) {
    case 'type':
      return generateType(node);
    case 'interface':
      return generateInterface(node);
    case 'fn':
      return generateFunction(node);
    case 'machine':
      return generateMachine(node);
    case 'error':
      return generateError(node);
    case 'config':
      return generateConfig(node);
    case 'store':
      return generateStore(node);
    case 'test':
      return generateTest(node);
    case 'event':
      return generateEvent(node);
    case 'import':
      return generateImport(node);
    case 'const':
      return generateConst(node);
    // Data layer
    case 'model':
      return generatePythonModel(node);
    case 'repository':
      return generatePythonRepository(node);
    case 'cache':
      return generatePythonCache(node);
    case 'dependency':
      return generatePythonDependency(node);
    case 'service':
      return generatePythonService(node);
    case 'union':
      return generatePythonUnion(node);
    // Backend infrastructure
    case 'job':
      return generatePythonJob(node);
    case 'storage':
      return generatePythonStorage(node);
    case 'email':
      return generatePythonEmail(node);
    // Ground layer
    case 'derive':
      return generateDerive(node);
    case 'transform':
      return generateTransform(node);
    case 'action':
      return generateAction(node);
    case 'guard':
      return generateGuard(node);
    case 'assume':
      return generateAssume(node);
    case 'invariant':
      return generateInvariant(node);
    case 'each':
      return generateEach(node);
    case 'collect':
      return generateCollect(node);
    case 'branch':
      return generateBranch(node);
    case 'resolve':
      return generateResolve(node);
    case 'expect':
      return generateExpect(node);
    case 'recover':
      return generateRecover(node);
    default:
      return [];
  }
}

// Wire up the dispatcher for recursive ground-layer nodes (each, branch)
setDispatcher(generatePythonCoreNode);
