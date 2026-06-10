import ts from 'typescript';
import { parseClosureBlockAst } from './closure-eligibility.js';

export interface LowerJsClosureBodyToPythonOptions {
  lowerExpression(expr: string): string;
  lowerCondition?(expr: string): string;
}

export interface LowerJsClosureBodyToPythonResult {
  ok: boolean;
  lines: string[];
  reason?: string;
}

function hasUnsupportedNestedConstruct(node: ts.Node): boolean {
  let unsupported = false;
  const visit = (child: ts.Node) => {
    if (
      ts.isArrowFunction(child) ||
      ts.isFunctionExpression(child) ||
      ts.isFunctionDeclaration(child) ||
      child.kind === ts.SyntaxKind.ThisKeyword ||
      child.kind === ts.SyntaxKind.YieldExpression
    ) {
      unsupported = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return unsupported;
}

export function lowerJsClosureBodyToPython(
  body: string,
  opts: LowerJsClosureBodyToPythonOptions,
): LowerJsClosureBodyToPythonResult {
  // Shared block parse — single source of truth with the v1 closure gate
  // (`closure-eligibility.ts`). The block carries its own SourceFile (created
  // with parent nodes), which we need for `expr.getText(sf)`.
  const block = parseClosureBlockAst(body);
  if (!block) return { ok: false, lines: [], reason: 'parse' };
  const sf = block.getSourceFile();
  if (hasUnsupportedNestedConstruct(block)) return { ok: false, lines: [], reason: 'unsupported-nested' };

  const lowerExpr = (expr: ts.Expression): string => opts.lowerExpression(expr.getText(sf));
  const lowerCond = (expr: ts.Expression): string =>
    opts.lowerCondition ? opts.lowerCondition(expr.getText(sf)) : `js_truthy(${lowerExpr(expr)})`;

  const emitStatement = (stmt: ts.Statement, indent: string): string[] | null => {
    if (ts.isVariableStatement(stmt)) {
      const flags = stmt.declarationList.flags;
      if ((flags & ts.NodeFlags.Let) === 0 && (flags & ts.NodeFlags.Const) === 0) return null;
      const lines: string[] = [];
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) return null;
        lines.push(`${indent}${decl.name.text} = ${lowerExpr(decl.initializer)}`);
      }
      return lines;
    }

    if (ts.isReturnStatement(stmt)) {
      return [`${indent}return ${stmt.expression ? lowerExpr(stmt.expression) : 'None'}`];
    }

    if (ts.isExpressionStatement(stmt)) {
      return [`${indent}${lowerExpr(stmt.expression)}`];
    }

    if (ts.isIfStatement(stmt)) {
      const consequent = emitStatementBody(stmt.thenStatement, `${indent}    `);
      if (!consequent) return null;
      const lines = [`${indent}if ${lowerCond(stmt.expression)}:`, ...nonEmptyBody(consequent, `${indent}    `)];
      if (stmt.elseStatement) {
        const alternate = emitStatementBody(stmt.elseStatement, `${indent}    `);
        if (!alternate) return null;
        lines.push(`${indent}else:`, ...nonEmptyBody(alternate, `${indent}    `));
      }
      return lines;
    }

    if (ts.isTryStatement(stmt)) {
      if (stmt.finallyBlock || !stmt.catchClause) return null;
      const tryLines = emitBlock(stmt.tryBlock, `${indent}    `);
      if (!tryLines) return null;
      const catchLines = emitBlock(stmt.catchClause.block, `${indent}    `);
      if (!catchLines) return null;
      const catchName = stmt.catchClause.variableDeclaration?.name;
      if (catchName && !ts.isIdentifier(catchName)) return null;
      return [
        `${indent}try:`,
        ...nonEmptyBody(tryLines, `${indent}    `),
        catchName ? `${indent}except Exception as ${catchName.text}:` : `${indent}except Exception:`,
        ...nonEmptyBody(catchLines, `${indent}    `),
      ];
    }

    if (ts.isForOfStatement(stmt)) {
      if (stmt.awaitModifier) return null;
      let target: string | null = null;
      const initializer = stmt.initializer;
      if (ts.isVariableDeclarationList(initializer)) {
        if (initializer.declarations.length !== 1) return null;
        const decl = initializer.declarations[0];
        if (!ts.isIdentifier(decl.name) || decl.initializer) return null;
        target = decl.name.text;
      } else if (ts.isIdentifier(initializer)) {
        target = initializer.text;
      }
      if (!target) return null;
      const bodyLines = emitStatementBody(stmt.statement, `${indent}    `);
      if (!bodyLines) return null;
      return [`${indent}for ${target} in ${lowerExpr(stmt.expression)}:`, ...nonEmptyBody(bodyLines, `${indent}    `)];
    }

    return null;
  };

  const emitStatementBody = (stmt: ts.Statement, indent: string): string[] | null => {
    if (ts.isBlock(stmt)) return emitBlock(stmt, indent);
    return emitStatement(stmt, indent);
  };

  const emitBlock = (b: ts.Block, indent: string): string[] | null => {
    const lines: string[] = [];
    for (const stmt of b.statements) {
      const emitted = emitStatement(stmt, indent);
      if (!emitted) return null;
      lines.push(...emitted);
    }
    return lines;
  };

  const nonEmptyBody = (lines: string[], indent: string): string[] => (lines.length > 0 ? lines : [`${indent}pass`]);

  const lines = emitBlock(block, '    ');
  if (!lines) return { ok: false, lines: [], reason: 'unsupported-statement' };
  return { ok: true, lines };
}
