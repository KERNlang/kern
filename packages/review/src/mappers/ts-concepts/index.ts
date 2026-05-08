/**
 * TypeScript Concept Mapper — extracts universal concepts from ts-morph AST.
 *
 * Phase 1: error_raise, error_handle, effect
 * Phase 2: entrypoint, guard, state_mutation, call, dependency
 */

import type { ConceptEdge, ConceptMap, ConceptNode } from '@kernlang/core';
import type { SourceFile } from 'ts-morph';
import { extractDependencyEdges } from './extractors/dependency.js';
import { extractEffects } from './extractors/effect.js';
import { extractEntrypoints } from './extractors/entrypoint-express/index.js';
import { extractNextjsHandlers } from './extractors/entrypoint-nextjs.js';
import { extractErrorHandle } from './extractors/error-handle.js';
import { extractErrorRaise } from './extractors/error-raise.js';
import { extractFunctionDeclarations } from './extractors/function-decls.js';
import { extractGuards } from './extractors/guard.js';
import { extractReactWrapperComponents } from './extractors/react-wrappers.js';
import { extractStateMutation } from './extractors/state-mutation.js';
import { EXTRACTOR_VERSION } from './signatures.js';

export function extractTsConcepts(sourceFile: SourceFile, filePath: string): ConceptMap {
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];

  extractErrorRaise(sourceFile, filePath, nodes);
  extractErrorHandle(sourceFile, filePath, nodes);
  extractEffects(sourceFile, filePath, nodes);
  extractEntrypoints(sourceFile, filePath, nodes);
  extractNextjsHandlers(sourceFile, filePath, nodes);
  extractGuards(sourceFile, filePath, nodes);
  extractStateMutation(sourceFile, filePath, nodes);
  extractFunctionDeclarations(sourceFile, filePath, nodes);
  extractReactWrapperComponents(sourceFile, filePath, nodes);
  extractDependencyEdges(sourceFile, filePath, edges);

  return {
    filePath,
    language: 'ts',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
