/**
 * Python Concept Mapper — tree-sitter based.
 *
 * Maps Python syntax → universal KERN concepts.
 * Phase 1: error_raise, error_handle, effect
 */

import type { ConceptEdge, ConceptMap, ConceptNode } from '@kernlang/core';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { extractBackgroundTasks } from './extractors/background-tasks.js';
import { extractDependencyEdges } from './extractors/dependency.js';
import { extractEffects } from './extractors/effect.js';
import { extractEntrypoints } from './extractors/entrypoint.js';
import { extractErrorHandle, extractErrorRaise } from './extractors/error.js';
import { extractGuards } from './extractors/guard.js';
import { extractStateMutation } from './extractors/state-mutation.js';
import { EXTRACTOR_VERSION } from './signatures.js';

let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Python as unknown as Parser.Language);
  }
  return parser;
}

export function extractPythonConcepts(source: string, filePath: string): ConceptMap {
  const tree = getParser().parse(source);
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];

  extractErrorRaise(tree.rootNode, source, filePath, nodes);
  extractErrorHandle(tree.rootNode, source, filePath, nodes);
  extractEffects(tree.rootNode, source, filePath, nodes);
  extractBackgroundTasks(tree.rootNode, source, filePath, nodes);

  extractEntrypoints(tree.rootNode, source, filePath, nodes);
  extractGuards(tree.rootNode, source, filePath, nodes);
  extractStateMutation(tree.rootNode, source, filePath, nodes);
  extractDependencyEdges(tree.rootNode, source, filePath, edges);

  return {
    filePath,
    language: 'py',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
