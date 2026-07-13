import type { IRNode } from '../../types.js';
import type { SemanticEnv } from './index.js';
import { referenceRunSequence } from './reference-runner.js';
import type { Trace } from './trace.js';

/** The only synchronous scalar-host edge to reference sequence execution. */
export const runPortableReferenceBody: (nodes: readonly IRNode[], env: SemanticEnv) => Trace = referenceRunSequence;
