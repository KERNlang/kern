// This facade deliberately exports authentication only. Issuance remains in
// frontend-projection.ts's lexical scope so no addressable emitted module can
// register a reconstructed projection.
export { isVerifiedKernProjection as authenticateVerifiedProjection } from '../frontend-projection.js';
