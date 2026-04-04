/**
 * Express review rules — active when target = express.
 *
 * All rules use ts-morph AST analysis — zero regex on source text.
 * Pattern established by doubleResponse, now applied uniformly.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ── Shared AST helpers ──────────────────────────────────────────────────

const REQ_PARAM = /^(req|request)$/i;
const RES_PARAM = /^(res|response)$/i;
const NEXT_PARAM = /^next$/i;

const RESPONSE_METHODS = new Set(['json', 'send', 'end', 'redirect', 'render', 'sendFile', 'sendStatus']);

const VALIDATION_METHODS = new Set(['parse', 'safeParse', 'validate']);

const REQUEST_PROPS = new Set(['body', 'params', 'query']);

/** Known objects whose .parse() is NOT request validation */
const KNOWN_NON_VALIDATORS = new Set(['JSON', 'url', 'querystring', 'path', 'Date', 'Number', 'parseInt', 'Buffer']);

/** Sync function names that block the event loop */
const SYNC_CALLS: Map<string, string> = new Map([
  ['readFileSync', 'readFile'],
  ['writeFileSync', 'writeFile'],
  ['existsSync', 'access'],
  ['mkdirSync', 'mkdir'],
  ['readdirSync', 'readdir'],
  ['statSync', 'stat'],
]);

/** Sync property calls: object.method → async alternative */
const SYNC_PROP_CALLS: Map<string, Map<string, string>> = new Map([
  [
    'fs',
    new Map([
      ['readFileSync', 'fs.promises.readFile'],
      ['writeFileSync', 'fs.promises.writeFile'],
      ['existsSync', 'fs.promises.access'],
      ['mkdirSync', 'fs.promises.mkdir'],
      ['readdirSync', 'fs.promises.readdir'],
      ['statSync', 'fs.promises.stat'],
    ]),
  ],
  [
    'crypto',
    new Map([
      ['pbkdf2Sync', 'pbkdf2'],
      ['scryptSync', 'scrypt'],
      ['randomBytes', 'randomBytes (callback)'],
    ]),
  ],
  [
    'child_process',
    new Map([
      ['execSync', 'exec'],
      ['spawnSync', 'spawn'],
    ]),
  ],
]);

type FnNode =
  | import('ts-morph').ArrowFunction
  | import('ts-morph').FunctionExpression
  | import('ts-morph').FunctionDeclaration
  | import('ts-morph').MethodDeclaration;

/** Check if a node is inside a nested function relative to a boundary node */
function isNestedScope(node: import('ts-morph').Node, boundary: import('ts-morph').Node): boolean {
  let cur = node.getParent();
  while (cur && cur !== boundary) {
    if (
      Node.isArrowFunction(cur) ||
      Node.isFunctionExpression(cur) ||
      Node.isFunctionDeclaration(cur) ||
      Node.isMethodDeclaration(cur)
    ) {
      return true;
    }
    cur = cur.getParent();
  }
  return false;
}

/** Collect all function-like nodes in the source file */
function allFunctions(ctx: RuleContext): FnNode[] {
  return [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ];
}

/** Find the named parameter matching a pattern, or undefined */
function findParam(fn: FnNode, pattern: RegExp) {
  return fn.getParameters().find((p) => pattern.test(p.getName()));
}

/** Check if a call expression calls a method on the given object name */
function isMethodCallOn(call: import('ts-morph').CallExpression, objName: string, methods: Set<string>): boolean {
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return false;
  if (!methods.has(expr.getName())) return false;
  const obj = expr.getExpression();
  // Direct: res.json()
  if (Node.isIdentifier(obj) && obj.getText() === objName) return true;
  // Chained: res.status(200).json()
  if (Node.isCallExpression(obj)) {
    const chainExpr = obj.getExpression();
    // res.status() → PropertyAccessExpression where object is Identifier 'res'
    if (Node.isPropertyAccessExpression(chainExpr)) {
      const root = chainExpr.getExpression();
      if (Node.isIdentifier(root) && root.getText() === objName) return true;
    }
  }
  return false;
}

// ── Rule: unvalidated-input ─────────────────────────────────────────────
// req.body/params/query used without validation in a handler

function unvalidatedInput(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of allFunctions(ctx)) {
    const reqParam = findParam(fn, REQ_PARAM);
    if (!reqParam || !findParam(fn, RES_PARAM)) continue;

    const body = fn.getBody();
    if (!body) continue;
    const reqName = reqParam.getName();

    // Check if this handler body has validation calls on the req param
    const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
    const hasValidation = calls.some((call) => {
      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return false;
      if (!VALIDATION_METHODS.has(expr.getName())) return false;
      const receiver = expr.getExpression();
      // Blocklist: known non-validators (JSON.parse, url.parse, etc.)
      if (Node.isIdentifier(receiver) && KNOWN_NON_VALIDATORS.has(receiver.getText())) return false;
      // TypeChecker path: if project available, check if receiver type looks like a schema
      if (ctx.project && Node.isIdentifier(receiver)) {
        try {
          const typeText = receiver.getType().getText(receiver);
          // Zod schemas: ZodType, ZodObject, ZodSchema, etc.
          // Joi schemas: ObjectSchema, AnySchema, etc.
          // Yup schemas: ObjectSchema, Schema, etc.
          if (/\b(Zod|Schema|Joi|Yup)\w*/i.test(typeText)) return true;
          // If type is fully resolved and doesn't look like a validator, skip
          if (typeText !== 'any' && !/schema|valid/i.test(typeText)) return false;
        } catch {
          /* TypeChecker may fail — fall through to heuristic */
        }
      }
      // Heuristic fallback: req param must appear in arguments
      return call.getArguments().some((arg) => arg.getText().includes(reqName));
    });

    // Check for custom validation guard: if(isValid...) / if(validate...) / if(check...)
    const hasCustomGuard = calls.some((call) => {
      const expr = call.getExpression();
      if (!Node.isIdentifier(expr)) return false;
      const name = expr.getText();
      return /^(?:isValid|validate|check)\w*$/.test(name);
    });

    // Find req.body / req.params / req.query property access
    for (const prop of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      if (isNestedScope(prop, body)) continue;

      const obj = prop.getExpression();
      if (!Node.isIdentifier(obj) || obj.getText() !== reqName) continue;
      const propName = prop.getName();
      if (!REQUEST_PROPS.has(propName)) continue;

      // Skip if inside a validation call: schema.parse(req.body)
      const parentCall = prop.getFirstAncestorByKind(SyntaxKind.CallExpression);
      if (parentCall && !isNestedScope(parentCall, body)) {
        const callExpr = parentCall.getExpression();
        if (Node.isPropertyAccessExpression(callExpr) && VALIDATION_METHODS.has(callExpr.getName())) continue;
      }

      // Skip if inside typeof expression (runtime type check)
      if (prop.getFirstAncestorByKind(SyntaxKind.TypeOfExpression)) continue;

      // Note: do NOT skip AsExpression (type cast) — `req.body as User` is not runtime validation

      // Skip if a custom validation guard exists before this access
      if (hasCustomGuard) {
        const guardCalls = calls.filter((c) => {
          const e = c.getExpression();
          return Node.isIdentifier(e) && /^(?:isValid|validate|check)\w*$/.test(e.getText());
        });
        if (guardCalls.some((g) => g.getStartLineNumber() < prop.getStartLineNumber())) continue;
      }

      findings.push(
        finding(
          'unvalidated-input',
          'error',
          'bug',
          `${reqName}.${propName} used without validation — potential injection vector`,
          ctx.filePath,
          prop.getStartLineNumber(),
          1,
          { suggestion: 'Validate with zod, joi, or express-validator before using request data' },
        ),
      );
    }

    // Also detect destructuring: const { name, email } = req.body
    if (!hasValidation) {
      for (const varDecl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (isNestedScope(varDecl, body)) continue;
        const nameNode = varDecl.getNameNode();
        if (!Node.isObjectBindingPattern(nameNode) && !Node.isArrayBindingPattern(nameNode)) continue;

        const init = varDecl.getInitializer();
        if (!init || !Node.isPropertyAccessExpression(init)) continue;
        const initObj = init.getExpression();
        if (!Node.isIdentifier(initObj) || initObj.getText() !== reqName) continue;
        const propName = init.getName();
        if (!REQUEST_PROPS.has(propName)) continue;

        findings.push(
          finding(
            'unvalidated-input',
            'error',
            'bug',
            `Destructured ${reqName}.${propName} without validation — potential injection vector`,
            ctx.filePath,
            varDecl.getStartLineNumber(),
            1,
            { suggestion: 'Validate with zod, joi, or express-validator before destructuring request data' },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule: missing-error-middleware ───────────────────────────────────────
// Express app without error handler (4-param middleware)

function missingErrorMiddleware(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Find variable declarations like: const app = express()
  const varDecls = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  const appDecl = varDecls.find((v) => {
    const init = v.getInitializer();
    return (
      init &&
      Node.isCallExpression(init) &&
      Node.isIdentifier(init.getExpression()) &&
      init.getExpression().getText() === 'express'
    );
  });
  if (!appDecl) return findings;

  const appName = appDecl.getName();
  const allCalls = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  // Check for app.use() with a 4-param function (error middleware signature)
  const has4ParamMiddleware = allCalls.some((call) => {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;
    if (expr.getName() !== 'use') return false;
    const obj = expr.getExpression();
    if (!Node.isIdentifier(obj) || obj.getText() !== appName) return false;

    return call.getArguments().some((arg) => {
      if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
        return arg.getParameters().length >= 4;
      }
      return false;
    });
  });

  // Check for errorHandler / error-handler identifier reference (imported handler)
  const hasErrorHandlerRef = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => {
    const name = id.getText();
    return name === 'errorHandler' || name === 'errorhandler';
  });
  // Also check string literals for 'error-handler' (require/import path)
  const hasErrorHandlerImport = ctx.sourceFile
    .getDescendantsOfKind(SyntaxKind.StringLiteral)
    .some((s) => s.getLiteralText().includes('error-handler'));

  if (!has4ParamMiddleware && !hasErrorHandlerRef && !hasErrorHandlerImport) {
    findings.push(
      finding(
        'missing-error-middleware',
        'warning',
        'pattern',
        'Express app has no error handling middleware — unhandled errors will crash the server',
        ctx.filePath,
        appDecl.getStartLineNumber(),
        1,
        { suggestion: 'app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); })' },
      ),
    );
  }

  return findings;
}

// ── Rule: sync-in-handler ───────────────────────────────────────────────
// Synchronous blocking calls in request handlers

function syncInHandler(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of allFunctions(ctx)) {
    if (!findParam(fn, REQ_PARAM) || !findParam(fn, RES_PARAM)) continue;

    const body = fn.getBody();
    if (!body) continue;

    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isNestedScope(call, body)) continue;

      const expr = call.getExpression();
      let syncName: string | undefined;
      let asyncAlt: string | undefined;

      if (Node.isIdentifier(expr)) {
        // Direct call: readFileSync()
        const name = expr.getText();
        asyncAlt = SYNC_CALLS.get(name);
        if (asyncAlt) syncName = name;
      } else if (Node.isPropertyAccessExpression(expr)) {
        // Property call: crypto.pbkdf2Sync()
        const obj = expr.getExpression();
        const method = expr.getName();
        if (Node.isIdentifier(obj)) {
          const objMethods = SYNC_PROP_CALLS.get(obj.getText());
          if (objMethods) {
            asyncAlt = objMethods.get(method);
            if (asyncAlt) syncName = method;
          }
        }
      }

      if (syncName && asyncAlt) {
        findings.push(
          finding(
            'sync-in-handler',
            'warning',
            'pattern',
            `${syncName} in request handler blocks the event loop — use ${asyncAlt} instead`,
            ctx.filePath,
            call.getStartLineNumber(),
            1,
            { suggestion: `Replace ${syncName} with async ${asyncAlt}` },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule: double-response ───────────────────────────────────────────────
// Express handler sends response more than once without early return

function doubleResponse(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of allFunctions(ctx)) {
    const resParam =
      findParam(fn, RES_PARAM) ?? fn.getParameters().find((p) => /\bResponse\b/.test(p.getType().getText(p)));
    const reqLike = fn
      .getParameters()
      .some(
        (p) =>
          REQ_PARAM.test(p.getName()) ||
          /^ctx$/i.test(p.getName()) ||
          /\b(Request|NextFunction)\b/.test(p.getType().getText(p)),
      );
    if (!resParam || !reqLike) continue;

    const resName = resParam.getName();
    const body = fn.getBody();
    if (!body || !Node.isBlock(body)) continue;

    const responseCalls: Array<{ line: number; method: string; hasReturn: boolean }> = [];
    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isNestedScope(call, body)) continue;

      if (!isMethodCallOn(call, resName, RESPONSE_METHODS)) continue;

      const expr = call.getExpression() as import('ts-morph').PropertyAccessExpression;
      const methodName = expr.getName();

      // Check if followed by return/throw
      const exprStmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
      let hasReturn = false;
      if (exprStmt) {
        const nextSibling = exprStmt.getNextSibling();
        if (nextSibling) {
          const nextKind = nextSibling.getKind();
          hasReturn = nextKind === SyntaxKind.ReturnStatement || nextKind === SyntaxKind.ThrowStatement;
        }
      }

      responseCalls.push({ line: call.getStartLineNumber(), method: methodName, hasReturn });
    }

    if (responseCalls.length < 2) continue;
    const hasUnguardedPrior = responseCalls.slice(0, -1).some((c) => !c.hasReturn);
    if (!hasUnguardedPrior) continue;

    for (let i = 1; i < responseCalls.length; i++) {
      if (responseCalls[i - 1].hasReturn) continue;
      const { line, method } = responseCalls[i];
      findings.push(
        finding(
          'double-response',
          'error',
          'bug',
          `Possible double response: ${resName}.${method}() may execute after an earlier response — add return after first send`,
          ctx.filePath,
          line,
          1,
          { suggestion: 'Return immediately after sending a response to prevent double-send errors' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: missing-next ──────────────────────────────────────────────────
// Middleware with (req, res, next) that neither sends a response nor calls next()

function missingNext(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of allFunctions(ctx)) {
    const params = fn.getParameters();
    if (params.length < 3) continue;

    if (!findParam(fn, REQ_PARAM)) continue;
    const resParam = findParam(fn, RES_PARAM);
    if (!resParam || !findParam(fn, NEXT_PARAM)) continue;

    const body = fn.getBody();
    if (!body) continue;
    const resName = resParam.getName();

    const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);

    // Check: calls next() — only counts if unconditional or covers all branches
    const nextCalls = calls.filter((call) => {
      if (isNestedScope(call, body)) return false;
      const expr = call.getExpression();
      return Node.isIdentifier(expr) && NEXT_PARAM.test(expr.getText());
    });

    // Check: sends a response (res.json, res.send, etc.)
    const responseCalls = calls.filter((call) => {
      if (isNestedScope(call, body)) return false;
      return isMethodCallOn(call, resName, RESPONSE_METHODS);
    });

    // Check: throws an error (delegates to error middleware)
    const throwStmts = body.getDescendantsOfKind(SyntaxKind.ThrowStatement).filter((t) => !isNestedScope(t, body));

    // No exit paths at all → definitely hangs
    const allExits = [...nextCalls, ...responseCalls, ...throwStmts] as import('ts-morph').Node[];
    if (allExits.length === 0) {
      findings.push(
        finding(
          'express-missing-next',
          'error',
          'bug',
          `Middleware accepts 'next' but neither calls next() nor sends a response — request will hang`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          { suggestion: 'Call next() to pass control to the next middleware, or send a response' },
        ),
      );
      continue;
    }

    // Check if exits cover all code paths by analyzing the function block.
    // An exit is "unconditional" if it's a direct child statement of the body block,
    // or if it's inside an if/else where BOTH branches have exits.
    const hasUnconditionalExit = allExits.some((exit) => {
      // Walk up from exit to body — if no IfStatement boundary, it's unconditional
      let cur: import('ts-morph').Node | undefined = exit;
      while (cur && cur !== body) {
        const parent: import('ts-morph').Node | undefined = cur.getParent();
        if (!parent || parent === body) return true; // reached body without hitting if
        if (Node.isIfStatement(parent) && !isNestedScope(parent, body)) {
          // Exit is inside an if — only counts if the sibling branch also has an exit
          const thenBlock = parent.getThenStatement();
          const elseBlock = parent.getElseStatement();
          if (!elseBlock) return false; // if without else — other path falls through
          const exitInThen = allExits.some((e) => thenBlock.containsRange(e.getStart(), e.getEnd()));
          const exitInElse = allExits.some((e) => elseBlock.containsRange(e.getStart(), e.getEnd()));
          if (exitInThen && exitInElse) return true; // both branches exit
          return false;
        }
        cur = parent;
      }
      return true;
    });

    if (!hasUnconditionalExit) {
      findings.push(
        finding(
          'express-missing-next',
          'warning',
          'bug',
          `Middleware only calls next()/responds in conditional branches — the other path may hang`,
          ctx.filePath,
          fn.getStartLineNumber(),
          1,
          { suggestion: 'Ensure all code paths call next() or send a response' },
        ),
      );
    }
  }

  return findings;
}

// ── Exported Express Rules ──────────────────────────────────────────────

export const expressRules = [unvalidatedInput, missingErrorMiddleware, syncInHandler, doubleResponse, missingNext];
