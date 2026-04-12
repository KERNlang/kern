/**
 * Rule layer loader — reads config.target and returns active review rules.
 *
 * Layers:
 *   [base]     Always active — universal TS/KERN rules
 *   [react]    Active when target = nextjs | tailwind | web | native | ink
 *   [ink]      Active when target = ink (on top of react)
 *   [vue]      Active when target = vue | nuxt
 *   [express]  Active when target = express
 *   [cli]      Active when target = cli
 *   [terminal] Active when target = terminal
 *   [fastapi]  Active when target = fastapi (Python concept layer)
 *   [nextjs]   Active when target = nextjs (on top of react)
 *   [nuxt]     Active when target = nuxt (on top of vue)
 */

import type { ReviewRule } from '../types.js';
import { baseRules } from './base.js';
import { cliRules } from './cli.js';
import { deadLogicRules } from './dead-logic.js';
import { expressRules } from './express.js';
import { fastapiRules } from './fastapi.js';
import { inkRules } from './ink.js';
import { nextjsRules } from './nextjs.js';
import { nullSafetyRules } from './null-safety.js';
import { nuxtRules } from './nuxt.js';
import { reactRules } from './react.js';
import { securityRules } from './security.js';
import { securityV2Rules } from './security-v2.js';
import { securityV3Rules } from './security-v3.js';
import { securityV4Rules } from './security-v4.js';
import { terminalRules } from './terminal.js';
import { vueRules } from './vue.js';

const REACT_TARGETS = new Set(['nextjs', 'tailwind', 'web', 'native', 'ink']);
const VUE_TARGETS = new Set(['vue', 'nuxt']);
/** Backend targets — never load frontend-specific rules */
const BACKEND_TARGETS = new Set(['express', 'fastapi', 'mcp', 'cli', 'terminal']);

/**
 * Get all active review rules for a given target.
 * Base + security + dead-logic + null-safety are always active; framework rules activate by target.
 */
export function getActiveRules(target?: string): ReviewRule[] {
  const rules: ReviewRule[] = [
    ...baseRules,
    ...securityRules,
    ...securityV2Rules,
    ...securityV3Rules,
    ...securityV4Rules,
    ...deadLogicRules,
    ...nullSafetyRules,
  ];

  // Backend targets never load frontend-specific rules
  const isBackend = target ? BACKEND_TARGETS.has(target) : false;

  if (!isBackend && target && REACT_TARGETS.has(target)) {
    rules.push(...reactRules);
  }

  if (!isBackend && target && VUE_TARGETS.has(target)) {
    rules.push(...vueRules);
  }

  if (!isBackend && target === 'nextjs') {
    rules.push(...nextjsRules);
  }

  if (!isBackend && target === 'nuxt') {
    rules.push(...nuxtRules);
  }

  if (target === 'express') {
    rules.push(...expressRules);
  }

  if (target === 'cli') {
    rules.push(...cliRules);
  }

  if (target === 'terminal') {
    rules.push(...terminalRules);
  }

  if (target === 'ink') {
    rules.push(...inkRules);
  }

  if (target === 'fastapi') {
    rules.push(...fastapiRules);
  }

  return rules;
}

// ── Rule Registry — metadata for --list-rules ───────────────────────────

export interface RuleInfo {
  id: string;
  layer: string;
  severity: 'error' | 'warning' | 'info';
  description: string;
  /**
   * Precision hint used by kern-sight to stratify rules in the sidebar.
   * 'high'         — rule has strong substrate (taint graph, file-context, ground-truth AST); ship on.
   * 'medium'       — rule relies on heuristics; consider hide-by-default after first scan.
   * 'experimental' — rule may be noisy; hide-by-default, promote after signal data proves it out.
   */
  precision?: 'high' | 'medium' | 'experimental';
  /**
   * Wave number in the rollout plan. Used by kern-sight to group new rules
   * visually and by `--list-rules` to surface what just landed. Wave 0 = substrate.
   */
  rolloutPhase?: number;
}

const REGISTRY: RuleInfo[] = [
  // Base (always active)
  {
    id: 'floating-promise',
    layer: 'base',
    severity: 'error',
    description: 'Unresolved async operation — missing await/void/return',
  },
  {
    id: 'state-mutation',
    layer: 'base',
    severity: 'error',
    description: 'Illegal state mutation outside designated setter',
  },
  { id: 'empty-catch', layer: 'base', severity: 'warning', description: 'Catch block swallows exception silently' },
  {
    id: 'machine-gap',
    layer: 'base',
    severity: 'warning',
    description: 'Unreachable state or missing transition in state machine',
  },
  {
    id: 'config-default-mismatch',
    layer: 'base',
    severity: 'warning',
    description: 'Config schema default does not match type',
  },
  {
    id: 'event-map-mismatch',
    layer: 'base',
    severity: 'warning',
    description: 'Event handler type mismatch with event map',
  },
  {
    id: 'non-exhaustive-switch',
    layer: 'base',
    severity: 'warning',
    description: 'Switch/map missing cases for known variants',
  },
  {
    id: 'cognitive-complexity',
    layer: 'base',
    severity: 'warning',
    description: 'Function exceeds cognitive complexity threshold',
  },
  {
    id: 'template-available',
    layer: 'base',
    severity: 'info',
    description: 'Pattern matches a registered KERN template',
  },
  {
    id: 'handler-extraction',
    layer: 'base',
    severity: 'info',
    description: 'Handler-like pattern could be extracted to KERN',
  },
  { id: 'memory-leak', layer: 'base', severity: 'error', description: 'Event listener added without cleanup' },
  { id: 'unhandled-async', layer: 'base', severity: 'warning', description: 'Async function without error handling' },
  {
    id: 'sync-in-async',
    layer: 'base',
    severity: 'warning',
    description: 'Synchronous blocking call inside async function',
  },
  {
    id: 'bare-rethrow',
    layer: 'base',
    severity: 'warning',
    description: 'Catch rethrows error without adding context',
  },

  // Security
  {
    id: 'xss-unsafe-html',
    layer: 'security',
    severity: 'error',
    description: 'innerHTML/dangerouslySetInnerHTML with untrusted data',
  },
  {
    id: 'hardcoded-secret',
    layer: 'security',
    severity: 'error',
    description: 'API key, password, or secret in source code',
  },
  {
    id: 'command-injection',
    layer: 'security',
    severity: 'error',
    description: 'exec/spawn with user-controlled input',
  },
  { id: 'no-eval', layer: 'security', severity: 'error', description: 'eval() or Function() constructor usage' },
  {
    id: 'insecure-random',
    layer: 'security',
    severity: 'warning',
    description: 'Math.random() used for security-sensitive operations',
  },
  { id: 'cors-wildcard', layer: 'security', severity: 'warning', description: 'CORS wildcard (*) origin allowed' },
  {
    id: 'helmet-missing',
    layer: 'security',
    severity: 'warning',
    description: 'Express app without helmet security headers',
  },
  {
    id: 'open-redirect',
    layer: 'security',
    severity: 'error',
    description: 'Unvalidated redirect target from user input',
  },

  // Security v2
  {
    id: 'jwt-weak-verification',
    layer: 'security-v2',
    severity: 'warning',
    description: 'JWT verified without algorithm restriction',
  },
  {
    id: 'cookie-hardening',
    layer: 'security-v2',
    severity: 'error',
    description: 'Cookie missing secure/httpOnly/sameSite flags',
  },
  {
    id: 'csrf-detection',
    layer: 'security-v2',
    severity: 'error',
    description: 'State-changing endpoint without CSRF protection',
  },
  {
    id: 'csp-strength',
    layer: 'security-v2',
    severity: 'warning',
    description: 'Weak Content-Security-Policy headers',
  },
  {
    id: 'path-traversal',
    layer: 'security-v2',
    severity: 'error',
    description: 'File path from user input without sanitization',
  },
  {
    id: 'weak-password-hashing',
    layer: 'security-v2',
    severity: 'error',
    description: 'MD5/SHA1 for password hashing instead of bcrypt/argon2',
  },

  // Security v3 — OWASP gap closure
  {
    id: 'regex-dos',
    layer: 'security-v3',
    severity: 'warning',
    description: 'Regex vulnerable to catastrophic backtracking (ReDoS)',
  },
  {
    id: 'missing-input-validation',
    layer: 'security-v3',
    severity: 'warning',
    description: 'User input used without validation',
  },
  {
    id: 'prototype-pollution',
    layer: 'security-v3',
    severity: 'error',
    description: 'Object.prototype mutation via user-controlled keys',
  },
  {
    id: 'information-exposure',
    layer: 'security-v3',
    severity: 'error',
    description: 'Stack traces or internal details in error responses',
  },
  {
    id: 'prompt-injection',
    layer: 'security-v3',
    severity: 'warning',
    description: 'User input concatenated into LLM prompts',
  },

  // Security v4 — LLM attack surface
  {
    id: 'indirect-prompt-injection',
    layer: 'security-v4',
    severity: 'warning',
    description: 'LLM prompt includes data from external/DB sources',
  },
  {
    id: 'llm-output-execution',
    layer: 'security-v4',
    severity: 'error',
    description: 'LLM-generated code executed without sandboxing',
  },
  {
    id: 'system-prompt-leakage',
    layer: 'security-v4',
    severity: 'warning',
    description: 'System prompt exposed in error paths or responses',
  },
  {
    id: 'rag-poisoning',
    layer: 'security-v4',
    severity: 'warning',
    description: 'RAG documents injected without provenance check',
  },
  {
    id: 'tool-calling-manipulation',
    layer: 'security-v4',
    severity: 'error',
    description: 'Tool/function call parameters from untrusted LLM output',
  },
  {
    id: 'encoding-bypass',
    layer: 'security-v4',
    severity: 'warning',
    description: 'Base64/unicode encoding used to bypass prompt filters',
  },
  {
    id: 'delimiter-injection',
    layer: 'security-v4',
    severity: 'warning',
    description: 'Prompt delimiter breakout via user input',
  },
  {
    id: 'unsanitized-history',
    layer: 'security-v4',
    severity: 'warning',
    description: 'Chat history concatenated without sanitization',
  },
  {
    id: 'json-output-manipulation',
    layer: 'security-v4',
    severity: 'warning',
    description: 'LLM JSON output used without schema validation',
  },
  {
    id: 'missing-output-validation',
    layer: 'security-v4',
    severity: 'warning',
    description: 'LLM output consumed without validation',
  },

  // Dead logic
  {
    id: 'identical-conditions',
    layer: 'dead-logic',
    severity: 'error',
    description: 'Duplicate conditions in if/else chain',
  },
  {
    id: 'identical-expressions',
    layer: 'dead-logic',
    severity: 'error',
    description: 'Same expression on both sides of operator',
  },
  {
    id: 'all-identical-branches',
    layer: 'dead-logic',
    severity: 'error',
    description: 'All branches produce identical code',
  },
  {
    id: 'constant-condition',
    layer: 'dead-logic',
    severity: 'warning',
    description: 'Condition is always true or always false',
  },
  {
    id: 'one-iteration-loop',
    layer: 'dead-logic',
    severity: 'warning',
    description: 'Loop body always exits on first iteration',
  },
  {
    id: 'unused-collection',
    layer: 'dead-logic',
    severity: 'warning',
    description: 'Collection created but never read',
  },
  {
    id: 'empty-collection-access',
    layer: 'dead-logic',
    severity: 'warning',
    description: 'Accessing elements of provably empty collection',
  },
  {
    id: 'redundant-jump',
    layer: 'dead-logic',
    severity: 'info',
    description: 'Unreachable code after return/break/continue',
  },

  // Null safety
  {
    id: 'unchecked-find',
    layer: 'null-safety',
    severity: 'warning',
    description: 'array.find() result used without null check',
  },
  {
    id: 'optional-chain-bang',
    layer: 'null-safety',
    severity: 'warning',
    description: 'Optional chain (?) immediately negated by non-null assertion (!)',
  },
  {
    id: 'unchecked-cast',
    layer: 'null-safety',
    severity: 'warning',
    description: 'Unsafe type assertion without runtime guard',
  },

  // React (target: nextjs, tailwind, web, native, ink)
  {
    id: 'async-effect',
    layer: 'react',
    severity: 'error',
    description: 'Async function passed directly to useEffect',
    precision: 'high',
  },
  {
    id: 'render-side-effect',
    layer: 'react',
    severity: 'error',
    description: 'Side effect (fetch, mutation) during render',
    precision: 'high',
  },
  {
    id: 'unstable-key',
    layer: 'react',
    severity: 'warning',
    description: 'Non-stable key prop (index, random, Date.now)',
    precision: 'high',
  },
  {
    id: 'stale-closure',
    layer: 'react',
    severity: 'warning',
    description: 'Stale variable captured in hook closure',
    precision: 'medium',
  },
  {
    id: 'state-explosion',
    layer: 'react',
    severity: 'warning',
    description: 'Excessive useState calls — consider useReducer',
    precision: 'medium',
  },
  {
    id: 'hook-order',
    layer: 'react',
    severity: 'error',
    description: 'React hook called inside condition or loop',
    precision: 'high',
  },
  {
    id: 'effect-self-update-loop',
    layer: 'react',
    severity: 'error',
    description: 'useEffect updates its own dependency — infinite loop',
    precision: 'high',
  },
  // React — backfilled from reactRules export (were exported but missing from registry)
  {
    id: 'missing-effect-cleanup',
    layer: 'react',
    severity: 'warning',
    description: 'useEffect uses setInterval/setTimeout/addEventListener without a cleanup return',
    precision: 'high',
  },
  {
    id: 'inline-context-value',
    layer: 'react',
    severity: 'warning',
    description: 'Inline object/array passed to Context.Provider value — forces consumer re-renders',
    precision: 'high',
  },
  {
    id: 'ref-in-render',
    layer: 'react',
    severity: 'error',
    description: 'Reading or writing ref.current during render — breaks React purity',
    precision: 'high',
  },
  {
    id: 'missing-memo-deps',
    layer: 'react',
    severity: 'warning',
    description: 'useMemo/useCallback dependency array missing an identifier referenced in the body',
    precision: 'high',
  },
  {
    id: 'reducer-mutation',
    layer: 'react',
    severity: 'error',
    description: 'Reducer mutates state instead of returning a new object',
    precision: 'high',
  },

  // CLI (target: cli)
  {
    id: 'cli-missing-shebang',
    layer: 'cli',
    severity: 'warning',
    description: 'Commander CLI entrypoint missing #!/usr/bin/env node',
  },
  {
    id: 'cli-missing-parse',
    layer: 'cli',
    severity: 'error',
    description: 'Command instance created without parse()/parseAsync()',
  },
  {
    id: 'cli-async-parse-sync',
    layer: 'cli',
    severity: 'error',
    description: 'Async Commander action paired with parse() instead of parseAsync()',
  },
  {
    id: 'cli-process-exit-in-action',
    layer: 'cli',
    severity: 'warning',
    description: 'Commander action handler calls process.exit() directly',
  },

  // Vue (target: vue, nuxt)
  {
    id: 'missing-ref-value',
    layer: 'vue',
    severity: 'warning',
    description: 'ref() used without .value in script setup',
  },
  {
    id: 'missing-onUnmounted',
    layer: 'vue',
    severity: 'error',
    description: 'watch/addEventListener without onUnmounted cleanup',
  },
  {
    id: 'setup-side-effect',
    layer: 'vue',
    severity: 'warning',
    description: 'Top-level await in setup without onMounted',
  },
  {
    id: 'reactive-destructure',
    layer: 'vue',
    severity: 'warning',
    description: 'Destructuring reactive() loses reactivity',
  },

  // Terminal (target: terminal)
  {
    id: 'terminal-missing-tty-guard',
    layer: 'terminal',
    severity: 'warning',
    description: 'Interactive terminal code runs without TTY guard',
  },
  {
    id: 'terminal-raw-mode-no-restore',
    layer: 'terminal',
    severity: 'error',
    description: 'stdin raw mode enabled without restore on exit',
  },
  {
    id: 'terminal-readline-no-close',
    layer: 'terminal',
    severity: 'warning',
    description: 'Readline interface never closed — process can hang',
  },
  {
    id: 'terminal-alt-screen-no-restore',
    layer: 'terminal',
    severity: 'warning',
    description: 'Alternate screen entered without restore on exit',
  },
  {
    id: 'terminal-missing-signal-handler',
    layer: 'terminal',
    severity: 'warning',
    description: 'No SIGINT/SIGTERM handler for cleanup',
  },
  {
    id: 'terminal-cursor-not-restored',
    layer: 'terminal',
    severity: 'warning',
    description: 'Cursor hidden without restore on exit',
  },
  {
    id: 'terminal-unthrottled-render',
    layer: 'terminal',
    severity: 'warning',
    description: 'Render loop with excessive refresh rate',
  },

  // Ink (target: ink, on top of React)
  {
    id: 'ink-console-output',
    layer: 'ink',
    severity: 'warning',
    description: 'console.* output corrupts Ink terminal rendering',
  },
  {
    id: 'ink-direct-stdout',
    layer: 'ink',
    severity: 'error',
    description: 'Direct stdout/stderr writes bypass Ink renderer',
  },
  {
    id: 'ink-process-exit',
    layer: 'ink',
    severity: 'warning',
    description: 'process.exit() used instead of useApp().exit()',
  },
  {
    id: 'ink-stdin-bypass',
    layer: 'ink',
    severity: 'warning',
    description: 'Raw stdin/readline listeners bypass Ink useInput()',
  },
  {
    id: 'ink-uncleared-interval',
    layer: 'ink',
    severity: 'warning',
    description: 'setInterval without cleanup in Ink component',
  },
  {
    id: 'ink-missing-error-boundary',
    layer: 'ink',
    severity: 'warning',
    description: 'Ink render() without error handling',
  },

  // Next.js (target: nextjs)
  { id: 'server-hook', layer: 'nextjs', severity: 'error', description: 'React hook used in Server Component' },
  {
    id: 'hydration-mismatch',
    layer: 'nextjs',
    severity: 'warning',
    description: 'Nondeterministic expression causes SSR/client mismatch',
  },
  {
    id: 'missing-use-client',
    layer: 'nextjs',
    severity: 'warning',
    description: 'Event handler in Server Component — needs use client',
  },

  // Nuxt (target: nuxt)
  {
    id: 'missing-ssr-guard',
    layer: 'nuxt',
    severity: 'error',
    description: 'Browser global accessed without SSR guard',
  },
  {
    id: 'nuxt-direct-fetch',
    layer: 'nuxt',
    severity: 'warning',
    description: 'Raw fetch() instead of $fetch/useFetch in Nuxt component',
  },
  {
    id: 'server-route-leak',
    layer: 'nuxt',
    severity: 'error',
    description: 'Server API route may expose sensitive fields',
  },

  // Express (target: express)
  {
    id: 'unvalidated-input',
    layer: 'express',
    severity: 'error',
    description: 'req.body/params/query used without validation',
  },
  {
    id: 'missing-error-middleware',
    layer: 'express',
    severity: 'warning',
    description: 'Express app without error-handling middleware',
  },
  { id: 'sync-in-handler', layer: 'express', severity: 'warning', description: 'Blocking I/O in request handler' },
  {
    id: 'double-response',
    layer: 'express',
    severity: 'error',
    description: 'Response sent twice without early return',
  },
  {
    id: 'express-missing-next',
    layer: 'express',
    severity: 'error',
    description: 'Middleware accepts next but never calls it — request hangs',
  },

  // FastAPI (target: fastapi, concept-based Python pipeline)
  {
    id: 'fastapi-missing-response-model',
    layer: 'fastapi',
    severity: 'warning',
    description: 'Endpoint without response_model — undocumented response',
  },
  {
    id: 'fastapi-blocking-sync-route',
    layer: 'fastapi',
    severity: 'warning',
    description: 'Blocking call in async route stalls event loop',
  },
  {
    id: 'fastapi-shared-state',
    layer: 'fastapi',
    severity: 'error',
    description: 'Route mutates global/module state — race condition',
  },
  {
    id: 'fastapi-broad-except',
    layer: 'fastapi',
    severity: 'warning',
    description: 'Broad except without re-raising HTTPException',
  },
  {
    id: 'fastapi-broad-cors',
    layer: 'fastapi',
    severity: 'warning',
    description: 'CORSMiddleware with allow_origins=["*"] — overly permissive',
  },

  // Concept rules (always active, language-agnostic)
  {
    id: 'boundary-mutation',
    layer: 'concept',
    severity: 'warning',
    description: 'Global/shared state mutation across boundaries',
  },
  { id: 'ignored-error', layer: 'concept', severity: 'warning', description: 'Caught exception silently ignored' },
  {
    id: 'unguarded-effect',
    layer: 'concept',
    severity: 'warning',
    description: 'Network/DB effect without auth/validation guard',
  },
  {
    id: 'unrecovered-effect',
    layer: 'concept',
    severity: 'warning',
    description: 'Network/DB effect without error recovery',
  },
];

/** Layer → target mapping for filtering */
const LAYER_TARGET_MAP: Record<string, string[] | null> = {
  base: null, // always active
  security: null,
  'security-v2': null,
  'security-v3': null,
  'security-v4': null,
  'dead-logic': null,
  'null-safety': null,
  concept: null,
  react: ['nextjs', 'tailwind', 'web', 'native', 'ink'],
  cli: ['cli'],
  vue: ['vue', 'nuxt'],
  ink: ['ink'],
  terminal: ['terminal'],
  nextjs: ['nextjs'],
  nuxt: ['nuxt'],
  express: ['express'],
  fastapi: ['fastapi'],
};

/**
 * Get the rule registry, optionally filtered by target.
 * Returns all rules active for the given target (universal + framework-specific).
 */
export function getRuleRegistry(target?: string): RuleInfo[] {
  if (!target) return [...REGISTRY];
  return REGISTRY.filter((r) => {
    const targets = LAYER_TARGET_MAP[r.layer];
    return targets === null || targets.includes(target);
  });
}
