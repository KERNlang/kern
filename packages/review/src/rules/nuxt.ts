/**
 * Nuxt review rules — active when target = nuxt (on top of Vue rules).
 *
 * Catches Nuxt 3 SSR / auto-import / server-route pitfalls.
 */

import { SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ── Rule: missing-ssr-guard ─────────────────────────────────────────────
// window / document / localStorage access without process.client or import.meta.client guard

const BROWSER_GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location'];

function missingSsrGuard(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Skip client-only files
  if (fullText.includes("'use client'") || fullText.includes('"use client"')) return findings;
  // Skip .client.ts/.client.vue files (Nuxt convention)
  if (ctx.filePath.includes('.client.')) return findings;

  // Build safe ranges: if (process.client) { ... } or if (import.meta.client) { ... }
  const safeRanges: Array<[number, number]> = [];
  const guardRegex = /(?:process\.client|import\.meta\.client|typeof window\s*!==?\s*['"]undefined['"])/g;
  let guardMatch;
  while ((guardMatch = guardRegex.exec(fullText)) !== null) {
    // Find the enclosing block — walk up to the if statement and capture the block
    const ifStart = fullText.lastIndexOf('if', guardMatch.index);
    if (ifStart === -1) continue;
    let depth = 0;
    let blockStart = -1;
    let blockEnd = -1;
    for (let i = guardMatch.index; i < fullText.length; i++) {
      if (fullText[i] === '{') {
        if (depth === 0) blockStart = i;
        depth++;
      }
      if (fullText[i] === '}') {
        depth--;
        if (depth === 0) { blockEnd = i; break; }
      }
    }
    if (blockStart !== -1 && blockEnd !== -1) {
      safeRanges.push([blockStart, blockEnd]);
    }
  }

  // Also mark onMounted callbacks as safe (they only run on client)
  const mountedRegex = /onMounted\s*\(/g;
  let mountedMatch;
  while ((mountedMatch = mountedRegex.exec(fullText)) !== null) {
    let depth = 0;
    let start = mountedMatch.index;
    for (let i = start; i < fullText.length; i++) {
      if (fullText[i] === '(') depth++;
      if (fullText[i] === ')') { depth--; if (depth === 0) { safeRanges.push([start, i]); break; } }
    }
  }

  const isInSafeRange = (idx: number) => safeRanges.some(([s, e]) => idx >= s && idx <= e);

  // Find browser global usages
  const reported = new Set<string>();
  for (const global of BROWSER_GLOBALS) {
    const regex = new RegExp(`\\b${global}\\b(?!\\s*(?:!==?|===?)\\s*['"]?undefined)`, 'g');
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      if (isInSafeRange(match.index)) continue;

      // Skip type-only contexts
      const lineText = fullText.split('\n')[fullText.substring(0, match.index).split('\n').length - 1] || '';
      if (lineText.trim().startsWith('//') || lineText.trim().startsWith('*')) continue;
      if (lineText.includes('typeof')) continue;

      // One finding per global to avoid noise
      if (reported.has(global)) continue;
      reported.add(global);

      const line = fullText.substring(0, match.index).split('\n').length;
      findings.push(finding('missing-ssr-guard', 'error', 'bug',
        `'${global}' accessed without SSR guard — will crash during server rendering`,
        ctx.filePath, line, 1,
        { suggestion: `Wrap in if (process.client) { ... } or use onMounted()` }));
    }
  }

  return findings;
}

// ── Rule: nuxt-direct-fetch ─────────────────────────────────────────────
// Using raw fetch() instead of $fetch / useFetch / useAsyncData in Nuxt

function nuxtDirectFetch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Only flag in pages/, components/, composables/, layouts/ — not in server/ or lib/
  const isComponentFile = /\/(pages|components|composables|layouts)\//.test(ctx.filePath);
  if (!isComponentFile) return findings;

  // Skip if file already uses $fetch / useFetch / useAsyncData
  if (fullText.includes('$fetch') || fullText.includes('useFetch') || fullText.includes('useAsyncData')) {
    return findings;
  }

  // Find raw fetch() calls
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.Identifier) continue;
    if (expr.getText() !== 'fetch') continue;

    const line = call.getStartLineNumber();
    findings.push(finding('nuxt-direct-fetch', 'warning', 'pattern',
      `Raw fetch() in Nuxt component — use $fetch or useFetch for SSR support and auto-dedup`,
      ctx.filePath, line, 1,
      { suggestion: 'Replace fetch() with $fetch() or useFetch() for proper SSR hydration' }));
    break; // One finding per file
  }

  return findings;
}

// ── Rule: server-route-leak ─────────────────────────────────────────────
// Server API routes returning sensitive fields without filtering

const SENSITIVE_FIELDS = new Set(['password', 'passwordHash', 'secret', 'token', 'apiKey',
  'api_key', 'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'ssn', 'creditCard', 'credit_card']);

function serverRouteLeak(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Only run on server/ API routes
  if (!ctx.filePath.includes('/server/') || !ctx.filePath.includes('/api/')) return findings;

  const fullText = ctx.sourceFile.getFullText();

  // Look for return statements or send() calls that spread database objects
  // Pattern: return { ...user } or return user (where user likely has sensitive fields)
  for (const ret of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    const expr = ret.getExpression();
    if (!expr) continue;

    const text = expr.getText();

    // Check for direct return of variables that likely contain sensitive data
    for (const field of SENSITIVE_FIELDS) {
      if (text.includes(field)) {
        const line = ret.getStartLineNumber();
        findings.push(finding('server-route-leak', 'error', 'bug',
          `Server API route may expose '${field}' — filter sensitive fields before returning`,
          ctx.filePath, line, 1,
          { suggestion: 'Destructure and return only needed fields: const { password, ...safe } = user; return safe;' }));
        return findings; // One finding per file
      }
    }
  }

  return findings;
}

// ── Exported Nuxt Rules ─────────────────────────────────────────────────

export const nuxtRules = [
  missingSsrGuard,
  nuxtDirectFetch,
  serverRouteLeak,
];
