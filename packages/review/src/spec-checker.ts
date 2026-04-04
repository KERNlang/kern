/**
 * Spec Checker — verifies .kern contracts against TypeScript implementation.
 *
 * The .kern file is a machine-readable security contract. This module
 * cross-checks declared auth, validation, guards, middleware, and error
 * handling against what the TypeScript code actually does.
 *
 * No other tool can do this — .kern IS the spec, and this verifies reality.
 */

import type { IRNode } from '@kernlang/core';
import { parse } from '@kernlang/core';
import { readFileSync } from 'fs';
import type { ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

// ── Contract types ───────────────────────────────────────────────────────

export interface AuthContract {
  mode: string; // 'required' | 'optional' | 'bearer' | custom
}

export interface ValidateContract {
  schema: string;
}

export interface GuardContract {
  name: string;
  expr?: string;
  elseStatus: number;
}

export interface MiddlewareContract {
  names: string[];
}

export interface ErrorContract {
  status: number;
  message?: string;
}

export interface SpecContract {
  method: string;
  path: string;
  routeKey: string;
  auth?: AuthContract;
  validate?: ValidateContract;
  guards: GuardContract[];
  middleware: MiddlewareContract[];
  errors: ErrorContract[];
  hasHandler: boolean;
  line: number;
  kernFile: string;
}

// ── Implementation types ─────────────────────────────────────────────────

export interface ImplRoute {
  method: string;
  path: string;
  routeKey: string;
  handlerBody: string;
  middlewareArgs: string[];
  filePath: string;
  startLine: number;
}

// ── Violation types ──────────────────────────────────────────────────────

export type ViolationKind =
  | 'spec-auth-missing'
  | 'spec-validate-missing'
  | 'spec-guard-missing'
  | 'spec-middleware-missing'
  | 'spec-error-unhandled'
  | 'spec-unimplemented'
  | 'spec-undeclared';

export interface SpecViolation {
  kind: ViolationKind;
  detail: string;
  suggestion: string;
  kernFile?: string;
  kernLine?: number;
  tsFile?: string;
  tsLine?: number;
}

export interface SpecCheckResult {
  violations: SpecViolation[];
  matched: Array<{ spec: SpecContract; impl: ImplRoute }>;
  unmatchedSpecs: SpecContract[];
  unmatchedImpls: ImplRoute[];
}

// ── Extract spec contracts from .kern ────────────────────────────────────

export function extractSpecContracts(kernSource: string, kernFile: string): SpecContract[] {
  const ast = parse(kernSource);
  const contracts: SpecContract[] = [];
  collectRoutes(ast, contracts, kernFile);
  return contracts;
}

function collectRoutes(node: IRNode, out: SpecContract[], kernFile: string): void {
  if (node.type === 'route') {
    const method = String(node.props?.method || 'get').toLowerCase();
    const path = String(node.props?.path || '/');
    const routeKey = `${method.toUpperCase()} ${path}`;

    const contract: SpecContract = {
      method,
      path,
      routeKey,
      guards: [],
      middleware: [],
      errors: [],
      hasHandler: false,
      line: node.loc?.line || 1,
      kernFile,
    };

    // Walk children for auth, validate, guard, middleware, error, handler
    if (node.children) {
      for (const child of node.children) {
        switch (child.type) {
          case 'auth':
            contract.auth = { mode: String(child.props?.mode || 'required') };
            break;
          case 'validate':
            contract.validate = { schema: String(child.props?.schema || '') };
            break;
          case 'guard': {
            const elseVal = child.props?.else;
            contract.guards.push({
              name: String(child.props?.name || 'guard'),
              expr: child.props?.expr ? String(child.props.expr) : undefined,
              elseStatus: typeof elseVal === 'number' ? elseVal : parseInt(String(elseVal || '404'), 10),
            });
            break;
          }
          case 'middleware': {
            const names: string[] = [];
            if (child.props?.names && Array.isArray(child.props.names)) {
              names.push(...(child.props.names as string[]));
            } else if (child.props?.name) {
              names.push(String(child.props.name));
            }
            if (names.length > 0) {
              contract.middleware.push({ names });
            }
            break;
          }
          case 'error':
            if (child.props?.status) {
              contract.errors.push({
                status:
                  typeof child.props.status === 'number'
                    ? child.props.status
                    : parseInt(String(child.props.status), 10),
                message: child.props?.message ? String(child.props.message) : undefined,
              });
            }
            break;
          case 'handler':
            contract.hasHandler = true;
            break;
        }
      }
    }

    out.push(contract);
  }

  // Recurse into ALL children (server, document nodes contain routes)
  if (node.children) {
    for (const child of node.children) {
      collectRoutes(child, out, kernFile);
    }
  }
}

// ── Extract implementation routes from .ts ───────────────────────────────

const ROUTE_REGEX = /\b(app|router|server)\.(get|post|put|delete|patch|head|options)\s*\(\s*(['"`])([^'"`]+)\3/gi;

export function extractImplRoutes(tsSource: string, filePath: string): ImplRoute[] {
  const routes: ImplRoute[] = [];
  const _lines = tsSource.split('\n');

  let match;
  ROUTE_REGEX.lastIndex = 0;
  while ((match = ROUTE_REGEX.exec(tsSource)) !== null) {
    const method = match[2].toLowerCase();
    const path = match[4];
    const routeKey = `${method.toUpperCase()} ${path}`;

    // Find line number
    const beforeMatch = tsSource.slice(0, match.index);
    const startLine = beforeMatch.split('\n').length;

    // Extract middleware args between path and handler
    const afterPath = tsSource.slice(match.index + match[0].length);
    const middlewareArgs = extractMiddlewareArgs(afterPath);

    // Extract handler body
    const handlerBody = extractHandlerBody(afterPath);

    routes.push({
      method,
      path,
      routeKey,
      handlerBody,
      middlewareArgs,
      filePath,
      startLine,
    });
  }

  return routes;
}

function extractMiddlewareArgs(afterPath: string): string[] {
  // After the path string, there are comma-separated middleware names
  // before the final (req, res) => { handler. Extract the identifiers.
  const names: string[] = [];

  // Match: , identifier, identifier, ... async? (req
  const argsSection = afterPath.match(/^((?:, ?\w+){0,10}) ?, ?(?:async )?\(/);
  if (!argsSection) return names;

  const argsText = argsSection[1];
  const parts = argsText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (/^\w+$/.test(part)) {
      names.push(part);
    }
  }

  return names;
}

function extractHandlerBody(afterPath: string): string {
  // Find the handler function body — look for (req, res) => { or function(req, res) {
  const handlerStart = afterPath.search(/(?:async\s*)?\([^)]*\)\s*(?:=>)?\s*\{/);
  if (handlerStart < 0) return '';

  const braceStart = afterPath.indexOf('{', handlerStart);
  if (braceStart < 0) return '';

  let depth = 1;
  let i = braceStart + 1;
  let inString: string | null = null;

  while (i < afterPath.length && depth > 0) {
    const ch = afterPath[i];

    if (inString) {
      if (ch === inString && afterPath[i - 1] !== '\\') inString = null;
      else if (ch === '\n' && inString !== '`') inString = null; // single/double quotes don't span lines
    } else {
      if (ch === '"' || ch === "'" || ch === '`') inString = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    i++;
  }

  return afterPath.slice(braceStart + 1, i - 1).trim();
}

// ── Route matching ───────────────────────────────────────────────────────

function pathsMatch(a: string, b: string): boolean {
  const sa = a.split('/').filter(Boolean);
  const sb = b.split('/').filter(Boolean);
  if (sa.length !== sb.length) return false;
  return sa.every((seg, i) => {
    const isParamA = seg.startsWith(':');
    const isParamB = sb[i].startsWith(':');
    if (isParamA && isParamB) return true;
    if (isParamA || isParamB) return false;
    return seg === sb[i];
  });
}

export function matchRoutes(
  specs: SpecContract[],
  impls: ImplRoute[],
): {
  matched: Array<{ spec: SpecContract; impl: ImplRoute }>;
  unmatchedSpecs: SpecContract[];
  unmatchedImpls: ImplRoute[];
} {
  const matched: Array<{ spec: SpecContract; impl: ImplRoute }> = [];
  const usedImpls = new Set<number>();

  for (const spec of specs) {
    // Try exact routeKey match first
    let implIdx = impls.findIndex((impl, i) => !usedImpls.has(i) && impl.routeKey === spec.routeKey);

    // Fallback: fuzzy path match (handles :id vs :userId)
    if (implIdx < 0) {
      implIdx = impls.findIndex(
        (impl, i) => !usedImpls.has(i) && impl.method === spec.method && pathsMatch(impl.path, spec.path),
      );
    }

    if (implIdx >= 0) {
      matched.push({ spec, impl: impls[implIdx] });
      usedImpls.add(implIdx);
    }
  }

  const unmatchedSpecs = specs.filter((s) => !matched.some((m) => m.spec === s));
  const unmatchedImpls = impls.filter((_, i) => !usedImpls.has(i));

  return { matched, unmatchedSpecs, unmatchedImpls };
}

// ── Contract verification ────────────────────────────────────────────────

const AUTH_MIDDLEWARE =
  /\b(auth|authenticate|requireAuth|requireLicense|verifyToken|jwtVerify|bearerAuth|isAuthenticated|authMiddleware|passport|requirePro)\b/i;
const AUTH_BODY = /\breq\.(user|auth)\b|verifyToken\s*\(|authenticate\s*\(|checkAuth\s*\(|requireLicense\b/;
const VALIDATION_CALL = /\.(parse|safeParse|validate|validateSync)\s?\(/;
const GUARD_CONDITIONAL = /if\s?\(\s?!?\s?\w+/;

function checkAuth(spec: SpecContract, impl: ImplRoute): SpecViolation | null {
  if (!spec.auth) return null;

  const hasAuthMiddleware = impl.middlewareArgs.some((a) => AUTH_MIDDLEWARE.test(a));
  const hasAuthInBody = AUTH_BODY.test(impl.handlerBody);

  if (!hasAuthMiddleware && !hasAuthInBody) {
    return {
      kind: 'spec-auth-missing',
      detail: `.kern declares 'auth ${spec.auth.mode}' on ${spec.routeKey} but no auth middleware or check found in implementation`,
      suggestion: 'Add auth middleware (e.g., requireLicense) to the route handler chain',
      kernFile: spec.kernFile,
      kernLine: spec.line,
      tsFile: impl.filePath,
      tsLine: impl.startLine,
    };
  }
  return null;
}

function checkValidate(spec: SpecContract, impl: ImplRoute): SpecViolation | null {
  if (!spec.validate) return null;

  const hasValidation = VALIDATION_CALL.test(impl.handlerBody);
  const _hasSchemaRef = impl.handlerBody.includes(spec.validate.schema);

  if (!hasValidation) {
    return {
      kind: 'spec-validate-missing',
      detail: `.kern declares 'validate ${spec.validate.schema}' on ${spec.routeKey} but no .parse()/.safeParse() found in handler`,
      suggestion: `Add ${spec.validate.schema}.safeParse(req.body) before processing the request`,
      kernFile: spec.kernFile,
      kernLine: spec.line,
      tsFile: impl.filePath,
      tsLine: impl.startLine,
    };
  }
  return null;
}

function checkGuards(spec: SpecContract, impl: ImplRoute): SpecViolation[] {
  const violations: SpecViolation[] = [];

  for (const guard of spec.guards) {
    const hasConditional = GUARD_CONDITIONAL.test(impl.handlerBody);
    const hasStatus =
      new RegExp(`\\.status\\s*\\(\\s*${guard.elseStatus}\\s*\\)`).test(impl.handlerBody) ||
      new RegExp(`sendStatus\\s*\\(\\s*${guard.elseStatus}\\s*\\)`).test(impl.handlerBody);

    if (!hasConditional || !hasStatus) {
      violations.push({
        kind: 'spec-guard-missing',
        detail: `.kern declares 'guard ${guard.name} else=${guard.elseStatus}' on ${spec.routeKey} but ${!hasConditional ? 'no conditional check' : `no ${guard.elseStatus} response`} found`,
        suggestion: `Add: if (!${guard.name}) return res.status(${guard.elseStatus}).json({ error: '...' })`,
        kernFile: spec.kernFile,
        kernLine: spec.line,
        tsFile: impl.filePath,
        tsLine: impl.startLine,
      });
    }
  }

  return violations;
}

function checkMiddleware(spec: SpecContract, impl: ImplRoute): SpecViolation[] {
  const violations: SpecViolation[] = [];
  const implMiddleware = impl.middlewareArgs.join(' ').toLowerCase();
  const bodyLower = impl.handlerBody.toLowerCase();

  for (const mw of spec.middleware) {
    for (const name of mw.names) {
      const nameLower = name.toLowerCase();
      if (!implMiddleware.includes(nameLower) && !bodyLower.includes(nameLower)) {
        violations.push({
          kind: 'spec-middleware-missing',
          detail: `.kern declares 'middleware ${name}' on ${spec.routeKey} but '${name}' not found in route registration or handler`,
          suggestion: `Add ${name} middleware to the route: router.${spec.method}('${spec.path}', ${name}, handler)`,
          kernFile: spec.kernFile,
          kernLine: spec.line,
          tsFile: impl.filePath,
          tsLine: impl.startLine,
        });
      }
    }
  }

  return violations;
}

function checkErrors(spec: SpecContract, impl: ImplRoute): SpecViolation[] {
  const violations: SpecViolation[] = [];

  for (const err of spec.errors) {
    // 500 is special — try/catch satisfies it
    if (err.status === 500 && /try\s*\{[\s\S]*?\}\s*catch/.test(impl.handlerBody)) continue;

    const hasStatus =
      new RegExp(`\\.status\\s*\\(\\s*${err.status}\\s*\\)`).test(impl.handlerBody) ||
      new RegExp(`sendStatus\\s*\\(\\s*${err.status}\\s*\\)`).test(impl.handlerBody);

    if (!hasStatus) {
      violations.push({
        kind: 'spec-error-unhandled',
        detail: `.kern declares 'error ${err.status}${err.message ? ` "${err.message}"` : ''}' on ${spec.routeKey} but status ${err.status} is never sent`,
        suggestion: `Ensure the handler can respond with res.status(${err.status}).json({ error: '${err.message || 'Error'}' })`,
        kernFile: spec.kernFile,
        kernLine: spec.line,
        tsFile: impl.filePath,
        tsLine: impl.startLine,
      });
    }
  }

  return violations;
}

export function verifyRouteContract(spec: SpecContract, impl: ImplRoute): SpecViolation[] {
  return [
    checkAuth(spec, impl),
    checkValidate(spec, impl),
    ...checkGuards(spec, impl),
    ...checkMiddleware(spec, impl),
    ...checkErrors(spec, impl),
  ].filter((v): v is SpecViolation => v !== null);
}

// ── Main entry ───────────────────────────────────────────────────────────

export function checkSpec(kernSource: string, kernFile: string, tsSource: string, tsFile: string): SpecCheckResult {
  const specs = extractSpecContracts(kernSource, kernFile);
  const impls = extractImplRoutes(tsSource, tsFile);
  const { matched, unmatchedSpecs, unmatchedImpls } = matchRoutes(specs, impls);

  const violations: SpecViolation[] = [];

  // Check each matched route
  for (const { spec, impl } of matched) {
    violations.push(...verifyRouteContract(spec, impl));
  }

  // Routes in .kern with no implementation
  for (const spec of unmatchedSpecs) {
    violations.push({
      kind: 'spec-unimplemented',
      detail: `${spec.routeKey} declared in .kern but no matching route handler found in implementation`,
      suggestion: `Implement the ${spec.method.toUpperCase()} ${spec.path} route handler`,
      kernFile: spec.kernFile,
      kernLine: spec.line,
    });
  }

  // Routes in .ts with no .kern declaration
  for (const impl of unmatchedImpls) {
    violations.push({
      kind: 'spec-undeclared',
      detail: `${impl.routeKey} exists in implementation but is not declared in .kern spec — undocumented endpoint`,
      suggestion: `Add to .kern: route ${impl.method.toUpperCase()} ${impl.path}`,
      tsFile: impl.filePath,
      tsLine: impl.startLine,
    });
  }

  return { violations, matched, unmatchedSpecs, unmatchedImpls };
}

// ── Finding conversion ───────────────────────────────────────────────────

const SEVERITY_MAP: Record<ViolationKind, 'error' | 'warning' | 'info'> = {
  'spec-auth-missing': 'error',
  'spec-validate-missing': 'warning',
  'spec-guard-missing': 'warning',
  'spec-middleware-missing': 'warning',
  'spec-error-unhandled': 'info',
  'spec-unimplemented': 'error',
  'spec-undeclared': 'info',
};

export function specViolationsToFindings(result: SpecCheckResult): ReviewFinding[] {
  return result.violations.map((v) => {
    const file = v.kernFile || v.tsFile || '';
    const line = v.kernLine || v.tsLine || 1;

    const primarySpan: SourceSpan = {
      file,
      startLine: line,
      startCol: 1,
      endLine: line,
      endCol: 1,
    };

    const relatedSpans: SourceSpan[] = [];
    if (v.kernFile && v.tsFile) {
      relatedSpans.push({
        file: v.tsFile,
        startLine: v.tsLine || 1,
        startCol: 1,
        endLine: v.tsLine || 1,
        endCol: 1,
      });
    }

    return {
      source: 'kern' as const,
      ruleId: v.kind,
      severity: SEVERITY_MAP[v.kind],
      category: 'bug' as const,
      message: v.detail,
      primarySpan,
      ...(relatedSpans.length > 0 ? { relatedSpans } : {}),
      suggestion: v.suggestion,
      fingerprint: createFingerprint(v.kind, line, 1),
    };
  });
}

// ── File-based entry points ──────────────────────────────────────────────

export function checkSpecFiles(kernFilePath: string, tsFilePath: string): SpecCheckResult {
  const kernSource = readFileSync(kernFilePath, 'utf-8');
  const tsSource = readFileSync(tsFilePath, 'utf-8');
  return checkSpec(kernSource, kernFilePath, tsSource, tsFilePath);
}
