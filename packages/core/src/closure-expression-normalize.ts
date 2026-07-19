import type ts from 'typescript';

interface SourceRemoval {
  start: number;
  end: number;
}

interface SourceEdit extends SourceRemoval {
  replacement: string;
}

function mergeRemovals(removals: SourceRemoval[]): SourceRemoval[] {
  const ordered = removals
    .filter((removal) => removal.end > removal.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: SourceRemoval[] = [];
  for (const removal of ordered) {
    const previous = merged.at(-1);
    if (previous && removal.start <= previous.end) previous.end = Math.max(previous.end, removal.end);
    else merged.push({ ...removal });
  }
  return merged;
}

function mergeEdits(first: SourceEdit[], second: SourceEdit[]): SourceEdit[] {
  const merged: SourceEdit[] = [];
  let firstIndex = 0;
  let secondIndex = 0;
  while (firstIndex < first.length || secondIndex < second.length) {
    const firstEdit = first[firstIndex];
    const secondEdit = second[secondIndex];
    const takeFirst =
      secondEdit === undefined ||
      (firstEdit !== undefined &&
        (firstEdit.start < secondEdit.start ||
          (firstEdit.start === secondEdit.start && firstEdit.end <= secondEdit.end)));
    const edit = takeFirst ? first[firstIndex++] : second[secondIndex++];
    if (!edit) continue;
    const previous = merged.at(-1);
    if (previous && edit.start < previous.end) {
      throw new Error('Internal codegen error: closure normalization edits overlap.');
    }
    merged.push(edit);
  }
  return merged;
}

/**
 * Normalize an accepted TypeScript closure expression to runtime-equivalent
 * source that the narrower KERN expression parser can consume. Type-only
 * wrappers, type arguments, and comments are removed with source-span edits.
 */
export function normalizeClosureExpressionSource(tsApi: typeof ts, expression: ts.Expression): string {
  const sourceFile = expression.getSourceFile();
  const sourceStart = expression.getStart(sourceFile);
  const sourceEnd = expression.getEnd();
  const source = sourceFile.text.slice(sourceStart, sourceEnd);
  const structuralRemovals: SourceRemoval[] = [];
  const scannerOpaqueSpans: SourceRemoval[] = [];
  const stack: ts.Node[] = [expression];
  const boundaryScanner = tsApi.createScanner(
    tsApi.ScriptTarget.Latest,
    true,
    tsApi.LanguageVariant.Standard,
    sourceFile.text,
  );

  const removeAbsolute = (start: number, end: number): void => {
    const relativeStart = Math.max(0, start - sourceStart);
    const relativeEnd = Math.min(source.length, end - sourceStart);
    if (relativeEnd > relativeStart) structuralRemovals.push({ start: relativeStart, end: relativeEnd });
  };
  const removeTypeArguments = (typeArguments: ts.NodeArray<ts.TypeNode> | undefined): void => {
    if (!typeArguments || typeArguments.length === 0) return;
    const open = typeArguments.pos - 1;
    boundaryScanner.setTextPos(typeArguments.end);
    const closeToken = boundaryScanner.scan();
    if (sourceFile.text[open] !== '<' || closeToken !== tsApi.SyntaxKind.GreaterThanToken) {
      throw new Error('Internal codegen error: TypeScript type-argument boundary is not canonical.');
    }
    removeAbsolute(open, boundaryScanner.getTextPos());
  };

  while (stack.length > 0) {
    const node = stack.pop() as ts.Node;
    if (
      node.kind === tsApi.SyntaxKind.RegularExpressionLiteral ||
      node.kind === tsApi.SyntaxKind.NoSubstitutionTemplateLiteral ||
      node.kind === tsApi.SyntaxKind.TemplateHead ||
      node.kind === tsApi.SyntaxKind.TemplateMiddle ||
      node.kind === tsApi.SyntaxKind.TemplateTail
    ) {
      const start = Math.max(0, node.getStart(sourceFile) - sourceStart);
      const end = Math.min(source.length, node.end - sourceStart);
      if (end > start) scannerOpaqueSpans.push({ start, end });
    }
    if (tsApi.isAsExpression(node) || tsApi.isSatisfiesExpression(node) || tsApi.isNonNullExpression(node)) {
      removeAbsolute(node.expression.end, node.end);
    } else if (tsApi.isTypeAssertionExpression(node)) {
      removeAbsolute(node.getStart(sourceFile), node.expression.getStart(sourceFile));
    }

    if (
      tsApi.isCallExpression(node) ||
      tsApi.isNewExpression(node) ||
      tsApi.isTaggedTemplateExpression(node) ||
      tsApi.isExpressionWithTypeArguments(node)
    ) {
      removeTypeArguments(node.typeArguments);
    }
    tsApi.forEachChild(node, (child) => {
      stack.push(child);
    });
  }

  const mergedStructuralRemovals = mergeRemovals(structuralRemovals);
  const protectedLiteralSpans = mergeRemovals(scannerOpaqueSpans);
  const commentEdits: SourceEdit[] = [];
  let structuralIndex = 0;
  let literalIndex = 0;
  const scanner = tsApi.createScanner(tsApi.ScriptTarget.Latest, false, tsApi.LanguageVariant.Standard, source);
  for (;;) {
    const position = scanner.getTextPos();
    while (literalIndex < protectedLiteralSpans.length && protectedLiteralSpans[literalIndex].end <= position) {
      literalIndex += 1;
    }
    const literalSpan = protectedLiteralSpans[literalIndex];
    if (literalSpan && literalSpan.start <= position && position < literalSpan.end) {
      scanner.setTextPos(literalSpan.end);
      continue;
    }

    const token = scanner.scan();
    if (token === tsApi.SyntaxKind.EndOfFileToken) break;
    if (token !== tsApi.SyntaxKind.SingleLineCommentTrivia && token !== tsApi.SyntaxKind.MultiLineCommentTrivia) {
      continue;
    }
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();
    while (
      structuralIndex < mergedStructuralRemovals.length &&
      mergedStructuralRemovals[structuralIndex].end <= start
    ) {
      structuralIndex += 1;
    }
    const structural = mergedStructuralRemovals[structuralIndex];
    if (!structural || structural.start >= end) {
      commentEdits.push({ start, end, replacement: token === tsApi.SyntaxKind.MultiLineCommentTrivia ? ' ' : '' });
    }
  }

  const structuralEdits = mergedStructuralRemovals.map((removal) => ({ ...removal, replacement: '' }));
  const edits = mergeEdits(structuralEdits, commentEdits);
  const normalized: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    normalized.push(source.slice(cursor, edit.start), edit.replacement);
    cursor = edit.end;
  }
  normalized.push(source.slice(cursor));
  return normalized.join('');
}
