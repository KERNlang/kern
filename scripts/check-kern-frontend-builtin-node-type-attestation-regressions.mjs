#!/usr/bin/env node
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
  lexical: runKernFrontendLexicalCheck(),
  nodeTypeTokenAdmission: runKernFrontendNodeTypeTokenAdmissionCheck(),
  retainedTokenStream: runKernFrontendRetainedTokenStreamCheck(),
  stitcher: runKernFrontendStitcherCheck(),
  tokenizer: runKernFrontendTokenizerCheck(),
  whitespaceTrim: runKernFrontendWhitespaceTrimCheck(),
};

console.log(`KERN frontend built-in node-type attestation regression wall: ${JSON.stringify(result)}`);
