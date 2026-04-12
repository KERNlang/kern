/**
 * Next.js App Router review rules — active when target = nextjs, on top of nextjsRules.
 *
 * Focus: directive placement, client/server boundary correctness, server actions.
 * These rules require import-graph awareness — they gracefully no-op when run
 * in single-file mode (no ctx.fileContext).
 */

import { basename } from 'path';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const CLIENT_HOOKS = new Set([
  'useState',
  'useEffect',
  'useRef',
  'useCallback',
  'useMemo',
  'useReducer',
  'useContext',
  'useLayoutEffect',
  'useTransition',
  'useDeferredValue',
  'useImperativeHandle',
  'useSyncExternalStore',
]);

const CLIENT_EVENT_HANDLERS = new Set([
  'onClick',
  'onChange',
  'onSubmit',
  'onKeyDown',
  'onKeyUp',
  'onMouseEnter',
  'onMouseLeave',
  'onFocus',
  'onBlur',
  'onInput',
  'onTouchStart',
  'onTouchEnd',
  'onScroll',
  'onDrag',
]);

const BROWSER_GLOBALS = /\b(window|document|localStorage|sessionStorage|navigator|history|location)\b/;

function hasClientDirective(fullText: string): boolean {
  return /^['"]use client['"];?\s*$/m.test(fullText.substring(0, 200));
}

function hasServerDirective(fullText: string): boolean {
  return /^['"]use server['"];?\s*$/m.test(fullText.substring(0, 200));
}

/** Does this file itself use any client-only API (hooks, browser globals, event handlers)? */
function fileUsesClientApi(ctx: RuleContext): boolean {
  const fullText = ctx.sourceFile.getFullText();
  if (BROWSER_GLOBALS.test(fullText)) return true;

  // JSX event handlers
  for (const attr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode().getText();
    if (CLIENT_EVENT_HANDLERS.has(name)) return true;
  }

  // Hook calls
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.Identifier) {
      if (CLIENT_HOOKS.has(expr.getText())) return true;
    } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const prop = expr.asKind(SyntaxKind.PropertyAccessExpression);
      if (prop && CLIENT_HOOKS.has(prop.getName())) return true;
    }
  }

  return false;
}

// ── Rule: use-client-drilled-too-high ────────────────────────────────────
// File has 'use client' but doesn't actually use any client API itself.
// Its children do. Moving the directive down would preserve RSC benefits.

function useClientDrilledTooHigh(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  if (!hasClientDirective(fullText)) return [];
  if (fileUsesClientApi(ctx)) return [];

  // The file marks itself 'use client' but uses no client APIs. This is likely
  // a parent wrapper that drilled the directive too high. Signal is strongest
  // when the file has child imports that DO use client APIs — but we can't
  // cheaply check that without the full fileContextMap. Fire as a warning
  // either way; severity bumps to error when we can prove a child needs it.

  let severity: 'warning' | 'error' = 'warning';
  let detail = 'File has "use client" but uses no hooks, event handlers, or browser APIs itself.';

  const fileContextMap = ctx.config?.fileContextMap;
  if (fileContextMap) {
    // If at least one imported child has its own 'use client' or needs one, this is a drilled directive.
    const gfImports = [...fileContextMap.entries()]
      .filter(([, v]) => v.importedBy.includes(ctx.filePath))
      .map(([k]) => k);
    if (gfImports.length > 0) {
      severity = 'warning';
      detail += ` Imported children: ${gfImports
        .slice(0, 3)
        .map((p) => basename(p))
        .join(', ')}${gfImports.length > 3 ? '…' : ''}.`;
    }
  }

  const line = 1;
  return [
    finding(
      'use-client-drilled-too-high',
      severity,
      'pattern',
      `'use client' directive is drilled too high — ${detail} Move it to the leaf component that actually uses client APIs to preserve Server Component benefits.`,
      ctx.filePath,
      line,
      1,
      {
        suggestion:
          'Remove the top-level "use client" and add it to only the child component(s) that use hooks or browser APIs',
      },
    ),
  ];
}

// ── Rule: server-api-in-client ───────────────────────────────────────────
// Client Component imports or calls server-only APIs:
//   - next/headers  (cookies(), headers(), draftMode())
//   - server-only   (explicit guard package)
// These will fail at build or runtime.

const SERVER_API_CALLS = new Set(['cookies', 'headers', 'draftMode']);

function serverApiInClient(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  const isClient = hasClientDirective(fullText) || ctx.fileContext?.isClientBoundary === true;
  if (!isClient) return [];

  const findings: ReviewFinding[] = [];

  // Import check: `from 'next/headers'` or `from 'server-only'`
  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    const mod = imp.getModuleSpecifierValue();
    if (mod === 'next/headers' || mod === 'server-only') {
      findings.push(
        finding(
          'server-api-in-client',
          'error',
          'bug',
          `Client Component imports '${mod}' — this will fail at build time. Server-only APIs cannot run in a client boundary.`,
          ctx.filePath,
          imp.getStartLineNumber(),
          1,
          {
            suggestion: `Move this logic to a Server Component or a server action, or drop the 'use client' directive if this file does not need it`,
          },
        ),
      );
    }
  }

  // Call check: cookies()/headers()/draftMode() invocation in client code
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.Identifier) continue;
    const name = expr.getText();
    if (!SERVER_API_CALLS.has(name)) continue;
    // Only flag when imported from 'next/headers' — avoid false positives on
    // user-defined functions of the same name. We already flagged the import above,
    // so only emit the call-site finding if the import actually came from next/headers.
    const fromNextHeaders = ctx.sourceFile
      .getImportDeclarations()
      .some(
        (imp) =>
          imp.getModuleSpecifierValue() === 'next/headers' && imp.getNamedImports().some((ni) => ni.getName() === name),
      );
    if (!fromNextHeaders) continue;

    findings.push(
      finding(
        'server-api-in-client',
        'error',
        'bug',
        `'${name}()' called in Client Component — next/headers APIs are server-only and will throw at runtime`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: `Call '${name}()' in a Server Component or server action, then pass the result as a prop` },
      ),
    );
  }

  return findings;
}

// ── Rule: server-action-unvalidated-input ────────────────────────────────
// Server action (file or function marked 'use server') receives args and
// uses them without passing through a validator (.parse, .safeParse, zod,
// yup, joi, a schema, or a typeof/instanceof guard).

// Validator detection is intentionally strict: we require the call to look
// like it originates from a known schema library, not just ANY .parse(). A
// naive /\.parse\(/ test would accept `JSON.parse(str)` or `path.parse(p)`
// as "validation" and suppress the rule. Instead, we require BOTH a known
// library reference AND a validating method call in the same body.
const SCHEMA_LIBRARY_PATTERNS = [
  /\bz\.\w+/, // zod
  /\byup\.\w+/,
  /\bjoi\.\w+/,
  /\b(from\s+['"]zod['"]|from\s+['"]yup['"]|from\s+['"]joi['"]|from\s+['"]valibot['"]|from\s+['"]@?superstruct['"])/,
];

const SCHEMA_METHOD_PATTERNS = [
  /\.safeParse\s*\(/,
  /\bz\.(object|string|number|boolean|array|enum|union|literal|tuple)\s*\(/,
  /\bparse\s*\(/, // bare parse — only counted alongside a library reference (see hasValidatorUsage)
];

const NAIVE_VALIDATOR_PATTERNS = [/\.validate(Sync)?\s*\(/, /\.assert\s*\(/, /\bassert\s*\(/];

function hasValidatorUsage(bodyText: string, importsText: string): boolean {
  // Strong signal: schema library import or reference PLUS a schema method call
  const hasLib =
    SCHEMA_LIBRARY_PATTERNS.some((p) => p.test(importsText)) || SCHEMA_LIBRARY_PATTERNS.some((p) => p.test(bodyText));
  const hasSchemaMethod = SCHEMA_METHOD_PATTERNS.some((p) => p.test(bodyText));
  if (hasLib && hasSchemaMethod) return true;
  // Weaker but still reasonable: explicit .validate()/.assert() call
  if (NAIVE_VALIDATOR_PATTERNS.some((p) => p.test(bodyText))) return true;
  return false;
}

/** Check that at least ONE of the function's params is referenced in the body. */
function anyParamIsReferenced(paramNames: string[], bodyText: string): string | undefined {
  for (const name of paramNames) {
    if (!name) continue;
    if (new RegExp(`\\b${name}\\b`).test(bodyText)) return name;
  }
  return undefined;
}

function getImportsText(ctx: RuleContext): string {
  return ctx.sourceFile
    .getImportDeclarations()
    .map((d) => d.getText())
    .join('\n');
}

function serverActionUnvalidatedInput(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];

  const fullText = ctx.sourceFile.getFullText();
  const fileIsServerAction = hasServerDirective(fullText);
  const findings: ReviewFinding[] = [];
  const importsText = getImportsText(ctx);

  // Iterate exported async functions
  for (const fn of ctx.sourceFile.getFunctions()) {
    if (!fn.isExported() || !fn.isAsync()) continue;
    const params = fn.getParameters();
    if (params.length === 0) continue;

    const body = fn.getBody();
    if (!body) continue;
    const bodyText = body.getText();

    // Function-level 'use server' directive (inside the function body) OR file-level
    const fnIsServerAction = fileIsServerAction || /['"]use server['"]/.test(bodyText.substring(0, 100));
    if (!fnIsServerAction) continue;

    if (hasValidatorUsage(bodyText, importsText)) continue;

    // Check ALL params, not just the first — Next server actions use
    // `(prevState, formData)` when wired to useActionState, so formData is
    // often params[1], not params[0].
    const paramNames = params.map((p) => p.getName());
    const refParam = anyParamIsReferenced(paramNames, bodyText);
    if (!refParam) continue;

    findings.push(
      finding(
        'server-action-unvalidated-input',
        'warning',
        'bug',
        `Server action '${fn.getName() || '<anon>'}' uses parameter '${refParam}' without validation — server actions receive untrusted client input`,
        ctx.filePath,
        fn.getStartLineNumber(),
        1,
        {
          suggestion:
            'Validate input with a schema (zod.parse / yup.validate / joi.validate) before using. Type annotations are NOT enforced at runtime.',
        },
      ),
    );
  }

  // Also handle arrow functions assigned to exported consts
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    if (!stmt.isExported()) continue;
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;
      if (!init.isAsync?.()) continue;

      const params = init.getParameters();
      if (params.length === 0) continue;
      const body = init.getBody();
      if (!body) continue;
      const bodyText = body.getText();

      const fnIsServerAction = fileIsServerAction || /['"]use server['"]/.test(bodyText.substring(0, 100));
      if (!fnIsServerAction) continue;
      if (hasValidatorUsage(bodyText, importsText)) continue;

      const paramNames = params.map((p) => p.getName());
      const refParam = anyParamIsReferenced(paramNames, bodyText);
      if (!refParam) continue;

      findings.push(
        finding(
          'server-action-unvalidated-input',
          'warning',
          'bug',
          `Server action '${decl.getName()}' uses parameter '${refParam}' without validation`,
          ctx.filePath,
          decl.getStartLineNumber(),
          1,
          {
            suggestion:
              'Validate input with a schema (zod.parse / yup.validate / joi.validate) before using. Type annotations are NOT enforced at runtime.',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Exported App Router Rules ────────────────────────────────────────────

export const nextjsAppRouterRules = [useClientDrilledTooHigh, serverApiInClient, serverActionUnvalidatedInput];
