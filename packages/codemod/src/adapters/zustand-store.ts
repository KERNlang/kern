/**
 * Zustand store adapter.
 *
 * Resolves and rewrites:
 *   export const useXStore = create<State>((set, get) => ({ ... }));
 *   export const useXStore = create<State>()((set, get) => ({ ... }));
 *
 * Fails closed on: aliased `create` imports, non-object returns, spread
 * elements, computed property keys, type-annotated actions where the declared
 * type diverges from the implementation, multiple zustand stores in one file,
 * and non-`create` calls.
 */

import type { TemplateMatch } from '@kernlang/review';
import {
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type Node,
  type ObjectLiteralExpression,
  type SourceFile,
  SyntaxKind,
  type VariableStatement,
} from 'ts-morph';
import type { ExtractResult, ResolvedRegion, ResolveResult, TemplateAdapter } from '../types.js';

const ZUSTAND_MODULE = 'zustand';
const CREATE_NAME = 'create';

function hasUnaliasedCreateImport(sourceFile: SourceFile): boolean {
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== ZUSTAND_MODULE) continue;
    for (const named of imp.getNamedImports()) {
      if (named.getName() !== CREATE_NAME) continue;
      // Fail closed on aliased import: `import { create as foo } from 'zustand'`
      const alias = named.getAliasNode();
      if (alias && alias.getText() !== CREATE_NAME) return false;
      return true;
    }
  }
  return false;
}

/**
 * Returns the CallExpression that looks like `create<T>(...)` or `create<T>()(...)`.
 * For the curried form, returns the OUTER call (the one whose callee is `create`)
 * because that's where `stateType` lives, and we still need to descend into the
 * inner call to find the object literal.
 */
function findCreateCall(node: Node | undefined): CallExpression | undefined {
  if (!node) return undefined;
  if (node.isKind(SyntaxKind.CallExpression)) {
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);
    const expr = call.getExpression();
    // Direct: create<T>(...)
    if (expr.isKind(SyntaxKind.Identifier) && expr.getText() === CREATE_NAME) {
      return call;
    }
    // Curried: create<T>()(...) — outer call's callee is itself a CallExpression
    // whose callee is the `create` identifier.
    if (expr.isKind(SyntaxKind.CallExpression)) {
      const inner = expr.asKindOrThrow(SyntaxKind.CallExpression);
      const innerExpr = inner.getExpression();
      if (innerExpr.isKind(SyntaxKind.Identifier) && innerExpr.getText() === CREATE_NAME) {
        return inner; // Return the inner `create<T>()` — outer call is the factory invocation
      }
    }
  }
  return undefined;
}

/**
 * Follow a create<T>(...) call to the ObjectLiteralExpression returned by its
 * state initializer. Handles:
 *   create<T>((set, get) => ({ ... }))        — direct arrow returning obj literal
 *   create<T>()((set, get) => ({ ... }))      — curried factory
 *   create<T>()((set) => { return { ... }; }) — arrow with block body
 */
function findStateObjectLiteral(createCall: CallExpression): ObjectLiteralExpression | undefined {
  // Determine the actual state-initializer call.
  // For curried form, the parent of createCall is a CallExpression whose arguments
  // hold the arrow fn. For direct form, createCall itself has the arguments.
  const parent = createCall.getParent();
  let argsCall: CallExpression;
  if (parent && parent.isKind(SyntaxKind.CallExpression)) {
    const parentCall = parent.asKindOrThrow(SyntaxKind.CallExpression);
    if (parentCall.getExpression() === createCall) {
      // Curried: parent call holds the arrow fn
      argsCall = parentCall;
    } else {
      argsCall = createCall;
    }
  } else {
    argsCall = createCall;
  }

  const args = argsCall.getArguments();
  if (args.length === 0) return undefined;
  const first = args[0];

  let body: Node | undefined;
  if (first.isKind(SyntaxKind.ArrowFunction)) {
    body = (first as ArrowFunction).getBody();
  } else if (first.isKind(SyntaxKind.FunctionExpression)) {
    body = (first as FunctionExpression).getBody();
  } else {
    return undefined;
  }

  if (!body) return undefined;

  // Body can be a direct ObjectLiteralExpression (arrow returning object literal
  // via parenthesized expression: `=> ({...})`) or a block statement that
  // returns an object literal.
  if (body.isKind(SyntaxKind.ObjectLiteralExpression)) {
    return body.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  }
  if (body.isKind(SyntaxKind.ParenthesizedExpression)) {
    const inner = body.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression();
    if (inner.isKind(SyntaxKind.ObjectLiteralExpression)) {
      return inner.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    }
  }
  if (body.isKind(SyntaxKind.Block)) {
    const block = body.asKindOrThrow(SyntaxKind.Block);
    const stmts = block.getStatements();
    if (stmts.length !== 1) return undefined;
    const only = stmts[0];
    if (!only.isKind(SyntaxKind.ReturnStatement)) return undefined;
    const retExpr = only.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
    if (retExpr && retExpr.isKind(SyntaxKind.ObjectLiteralExpression)) {
      return retExpr.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    }
    if (retExpr && retExpr.isKind(SyntaxKind.ParenthesizedExpression)) {
      const inner = retExpr.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression();
      if (inner.isKind(SyntaxKind.ObjectLiteralExpression)) {
        return inner.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      }
    }
  }
  return undefined;
}

function findOwningVariableStatement(call: CallExpression): VariableStatement | undefined {
  let cur: Node | undefined = call;
  while (cur) {
    if (cur.isKind(SyntaxKind.VariableStatement)) {
      return cur.asKindOrThrow(SyntaxKind.VariableStatement);
    }
    cur = cur.getParent();
  }
  return undefined;
}

function countCreateCalls(sourceFile: SourceFile): number {
  let count = 0;
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const createCall = findCreateCall(call);
    if (createCall === call) count++;
  }
  return count;
}

export const zustandStoreAdapter: TemplateAdapter = {
  templateName: 'zustand-store',

  resolveRegion(sourceFile: SourceFile, _match: TemplateMatch): ResolveResult {
    if (!hasUnaliasedCreateImport(sourceFile)) {
      return { ok: false, reason: 'zustand `create` is missing or aliased' };
    }

    // Reject files with multiple zustand stores to avoid ambiguity on which to rewrite.
    if (countCreateCalls(sourceFile) > 1) {
      return { ok: false, reason: 'multiple zustand stores in file' };
    }

    // Find the one create call and walk up to its VariableStatement.
    let createCall: CallExpression | undefined;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const found = findCreateCall(call);
      if (found === call) {
        createCall = call;
        break;
      }
    }
    if (!createCall) {
      return { ok: false, reason: 'no create<T>(...) call found' };
    }

    const varStmt = findOwningVariableStatement(createCall);
    if (!varStmt) {
      return { ok: false, reason: 'create call is not inside a variable declaration' };
    }

    // Sanity check: exactly one declaration, and its initializer transitively contains our call.
    const decls = varStmt.getDeclarations();
    if (decls.length !== 1) {
      return { ok: false, reason: 'multi-declarator variable statement' };
    }

    return {
      ok: true,
      region: {
        start: varStmt.getStart(),
        end: varStmt.getEnd(),
        label: `VariableStatement@L${varStmt.getStartLineNumber()}`,
      },
    };
  },

  extractChildren(sourceFile: SourceFile, _region: ResolvedRegion, _match: TemplateMatch): ExtractResult {
    // Re-resolve the create call — the region only gives us offsets, not the node.
    let createCall: CallExpression | undefined;
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const found = findCreateCall(call);
      if (found === call) {
        createCall = call;
        break;
      }
    }
    if (!createCall) {
      return { ok: false, reason: 'create call disappeared during extract' };
    }

    const objLit = findStateObjectLiteral(createCall);
    if (!objLit) {
      return { ok: false, reason: 'state initializer is not an object literal' };
    }

    const properties = objLit.getProperties();
    if (properties.length === 0) {
      return { ok: true, children: [] };
    }

    const childLines: string[] = [];
    for (const prop of properties) {
      // Fail closed on anything that isn't a plain PropertyAssignment or ShorthandPropertyAssignment.
      if (prop.isKind(SyntaxKind.SpreadAssignment)) {
        return { ok: false, reason: 'spread in state initializer' };
      }
      if (prop.isKind(SyntaxKind.GetAccessor) || prop.isKind(SyntaxKind.SetAccessor)) {
        return { ok: false, reason: 'accessor in state initializer' };
      }
      if (prop.isKind(SyntaxKind.MethodDeclaration)) {
        // Method shorthand — emit as-is.
        childLines.push(prop.getText());
        continue;
      }
      if (prop.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
        childLines.push(prop.getText());
        continue;
      }
      if (prop.isKind(SyntaxKind.PropertyAssignment)) {
        const assignment = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
        const nameNode = assignment.getNameNode();
        // Reject computed keys like [Symbol.iterator] or [dynamicKey].
        if (nameNode.isKind(SyntaxKind.ComputedPropertyName)) {
          return { ok: false, reason: 'computed property key in state initializer' };
        }
        childLines.push(prop.getText());
        continue;
      }
      return {
        ok: false,
        reason: `unsupported property kind: ${(prop as Node).getKindName()}`,
      };
    }

    // Append commas between lines to preserve object-literal syntax when re-emitted
    // inside the template's `({ {{CHILDREN}} })`.
    const withCommas = childLines.map((line, i) => {
      const needsComma = i < childLines.length - 1 || !line.trimEnd().endsWith(',');
      if (!needsComma) return line;
      if (line.trimEnd().endsWith(',')) return line;
      return `${line},`;
    });

    return { ok: true, children: withCommas };
  },
};
