#!/usr/bin/env node
import { runKernFrontendKnownNodeWarningCheck } from './check-kern-frontend-known-node-warning.mjs';
import { runKernFrontendMutableNodeTypeRegistrySnapshotCheck } from './check-kern-frontend-mutable-node-type-registry-snapshot.mjs';
import { runKernFrontendBuiltinNodeTypeAttestationCheck } from './check-kern-frontend-builtin-node-type-attestation.mjs';
import { runKernFrontendNodeTypeTokenAdmissionCheck } from './check-kern-frontend-node-type-token-admission.mjs';
import { runKernFrontendRetainedTokenStreamCheck } from './check-kern-frontend-retained-token-stream.mjs';
import { runKernFrontendCommentBoundaryCheck } from './check-kern-frontend-comment-boundaries.mjs';
import { runKernFrontendIndentationCheck } from './check-kern-frontend-indentation.mjs';
import { runKernFrontendLexicalCheck } from './check-kern-frontend-lexical.mjs';
import { runKernFrontendStitcherCheck } from './check-kern-frontend-stitcher.mjs';
import { runKernFrontendTokenizerCheck } from './check-kern-frontend-tokenizer.mjs';
import { runKernFrontendWhitespaceTrimCheck } from './check-kern-frontend-whitespace-trim.mjs';

const result = {
  builtinNodeTypeAttestation: runKernFrontendBuiltinNodeTypeAttestationCheck(),
  commentBoundary: runKernFrontendCommentBoundaryCheck(),
  indentation: runKernFrontendIndentationCheck(),
  knownNodeWarning: runKernFrontendKnownNodeWarningCheck(),
  lexical: runKernFrontendLexicalCheck(),
  mutableNodeTypeRegistrySnapshot: runKernFrontendMutableNodeTypeRegistrySnapshotCheck(),
  nodeTypeTokenAdmission: runKernFrontendNodeTypeTokenAdmissionCheck(),
  retainedTokenStream: runKernFrontendRetainedTokenStreamCheck(),
  stitcher: runKernFrontendStitcherCheck(),
  tokenizer: runKernFrontendTokenizerCheck(),
  whitespaceTrim: runKernFrontendWhitespaceTrimCheck(),
};

console.log(`KERN frontend known-node warning regression wall: ${JSON.stringify(result)}`);
