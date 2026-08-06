#!/usr/bin/env node
import { runKernFrontendCommentBoundaryCheck } from './check-kern-frontend-comment-boundaries.mjs';
import { runKernFrontendIndentationCheck } from './check-kern-frontend-indentation.mjs';
import { runKernFrontendLexicalCheck } from './check-kern-frontend-lexical.mjs';
import { runKernFrontendRetainedTokenStreamCheck } from './check-kern-frontend-retained-token-stream.mjs';
import { runKernFrontendStitcherCheck } from './check-kern-frontend-stitcher.mjs';
import { runKernFrontendTokenizerCheck } from './check-kern-frontend-tokenizer.mjs';
import { runKernFrontendWhitespaceTrimCheck } from './check-kern-frontend-whitespace-trim.mjs';

const tokenizer = runKernFrontendTokenizerCheck();
const stitcher = runKernFrontendStitcherCheck();
const indentation = runKernFrontendIndentationCheck();
const lexical = runKernFrontendLexicalCheck();
const commentBoundary = runKernFrontendCommentBoundaryCheck();
const whitespaceTrim = runKernFrontendWhitespaceTrimCheck();
const retainedTokenStream = runKernFrontendRetainedTokenStreamCheck();

process.stdout.write(
  `KERN frontend retained token stream regression wall: ${JSON.stringify({
    commentBoundary,
    indentation,
    lexical,
    retainedTokenStream,
    stitcher,
    tokenizer,
    whitespaceTrim,
  })}\n`,
);
