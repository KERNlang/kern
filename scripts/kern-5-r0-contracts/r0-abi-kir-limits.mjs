import { loadCanonicalizerPolicy } from '../kern-canonicalizer/policy.mjs';

// KIR v1 hex-embeds its components, so its accepted codec envelope needs a
// larger text cell than an individual structural component.
export const r0KirLimits = Object.freeze({ ...loadCanonicalizerPolicy().kirLimits, maxStringBytes: 262_144 });
