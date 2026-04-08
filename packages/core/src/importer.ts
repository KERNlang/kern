/**
 * TypeScript → .kern Importer
 *
 * Reads TypeScript source and produces .kern output by recognizing structural patterns:
 * type aliases, interfaces, functions, classes (→ service/error), constants, imports.
 * Function/method bodies become <<<>>> handler blocks.
 * JSDoc comments become doc nodes.
 *
 * Uses the TypeScript compiler API (already a dependency) — no ts-morph needed.
 */

import ts from 'typescript';

export interface ImportResult {
  /** The generated .kern source */
  kern: string;
  /** TS constructs that couldn't be mapped */
  unmapped: string[];
  /** Stats about what was imported */
  stats: {
    types: number;
    interfaces: number;
    functions: number;
    classes: number;
    imports: number;
    constants: number;
    enums: number;
    components: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isAsync(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

function isStatic(node: ts.MethodDeclaration | ts.PropertyDeclaration): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;
}

function isPrivate(node: ts.PropertyDeclaration | ts.MethodDeclaration): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
}

function isReadonly(node: ts.PropertyDeclaration): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
}

function isDefault(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function typeToString(typeNode: ts.TypeNode | undefined, source: ts.SourceFile): string {
  if (!typeNode) return '';
  return typeNode.getText(source);
}

function getJSDoc(node: ts.Node, source: ts.SourceFile): string | undefined {
  const jsDocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
  if (!jsDocs || jsDocs.length === 0) return undefined;
  const doc = jsDocs[0];
  const text = doc.comment;
  if (typeof text === 'string') return text.trim();
  if (Array.isArray(text)) {
    return text.map((part: any) => (typeof part === 'string' ? part : part.getText(source))).join('').trim();
  }
  return undefined;
}

function indent(lines: string[], depth: number): string[] {
  const prefix = '  '.repeat(depth);
  return lines.map((l) => `${prefix}${l}`);
}

function escapeKernString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatParams(params: ts.NodeArray<ts.ParameterDeclaration>, source: ts.SourceFile): string {
  return params
    .map((p) => {
      const name = p.name.getText(source);
      const type = typeToString(p.type, source);
      const optional = p.questionToken ? '?' : '';
      const defaultVal = p.initializer ? `=${p.initializer.getText(source)}` : '';
      return type ? `${name}${optional}:${type}${defaultVal}` : `${name}${optional}${defaultVal}`;
    })
    .join(',');
}

function getBodyText(body: ts.Block | ts.Expression | undefined, source: ts.SourceFile): string | undefined {
  if (!body) return undefined;
  if (ts.isBlock(body)) {
    const statements = body.statements;
    if (statements.length === 0) return undefined;
    // Get the text between the braces
    const fullText = body.getText(source);
    // Strip outer { }
    const inner = fullText.slice(1, -1);
    return dedentBlock(inner);
  }
  // Arrow function expression body
  return body.getText(source);
}

function dedentBlock(text: string): string {
  const lines = text.split('\n');
  // Find minimum indentation (ignoring empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const leading = line.match(/^(\s*)/)?.[1].length ?? 0;
    minIndent = Math.min(minIndent, leading);
  }
  if (minIndent === Infinity || minIndent === 0) return text.trim();
  return lines
    .map((line) => (line.trim().length === 0 ? '' : line.slice(minIndent)))
    .join('\n')
    .trim();
}

// ── Node converters ─────────────────────────────────────────────────────

function convertImport(node: ts.ImportDeclaration, source: ts.SourceFile): string[] {
  const lines: string[] = [];
  const moduleSpec = node.moduleSpecifier.getText(source).replace(/['"]/g, '');
  const clause = node.importClause;

  if (!clause) {
    // Side-effect import: import './setup'
    lines.push(`import from="${moduleSpec}"`);
    return lines;
  }

  const parts: string[] = [`import from="${moduleSpec}"`];
  const isTypeOnly = clause.isTypeOnly;

  if (clause.name) {
    // Default import
    parts.push(`default=${clause.name.getText(source)}`);
  }

  let hasTypeOnlySpecifiers = false;
  if (clause.namedBindings) {
    if (ts.isNamedImports(clause.namedBindings)) {
      const names = clause.namedBindings.elements.map((e) => {
        // Strip 'type' modifier and 'as Alias' — use the local name only
        if (e.isTypeOnly) hasTypeOnlySpecifiers = true;
        return e.name.getText(source);
      }).join(',');
      parts.push(`names="${names}"`);
    }
  }

  if (isTypeOnly || hasTypeOnlySpecifiers) {
    parts.push('types=true');
  }

  lines.push(parts.join(' '));
  return lines;
}

function convertTypeAlias(node: ts.TypeAliasDeclaration, source: ts.SourceFile): string[] {
  const lines: string[] = [];
  const name = node.name.getText(source);
  const exp = isExported(node) ? ' export=true' : '';
  const doc = getJSDoc(node, source);

  if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

  // Check for string literal union: type X = 'a' | 'b' | 'c'
  if (ts.isUnionTypeNode(node.type)) {
    const members = node.type.types;
    const allStringLiterals = members.every(
      (m) => ts.isLiteralTypeNode(m) && m.literal.kind === ts.SyntaxKind.StringLiteral,
    );
    if (allStringLiterals) {
      const values = members
        .map((m) => ((m as ts.LiteralTypeNode).literal as ts.StringLiteral).text)
        .join('|');
      lines.push(`type name=${name} values="${values}"${exp}`);
      return lines;
    }
  }

  // General type alias
  const typeText = typeToString(node.type, source);
  lines.push(`type name=${name} alias="${escapeKernString(typeText)}"${exp}`);
  return lines;
}

function convertInterface(node: ts.InterfaceDeclaration, source: ts.SourceFile): string[] {
  const lines: string[] = [];
  const name = node.name.getText(source);
  const exp = isExported(node) ? ' export=true' : '';
  const doc = getJSDoc(node, source);

  if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

  const extends_ = node.heritageClauses
    ?.filter((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
    .flatMap((h) => h.types.map((t) => t.getText(source)));
  const extendsStr = extends_ && extends_.length > 0 ? ` extends=${extends_.join(',')}` : '';

  lines.push(`interface name=${name}${extendsStr}${exp}`);

  for (const member of node.members) {
    if (ts.isPropertySignature(member)) {
      const fieldName = member.name.getText(source);
      const fieldType = typeToString(member.type, source);
      const optional = member.questionToken ? ' optional=true' : '';
      const fieldDoc = getJSDoc(member, source);
      if (fieldDoc) lines.push(`  doc text="${escapeKernString(fieldDoc)}"`);
      lines.push(`  field name=${fieldName}${fieldType ? ` type=${fieldType}` : ''}${optional}`);
    } else if (ts.isMethodSignature(member)) {
      // Interface method signatures → field with function type (schema only allows field children)
      const methodName = member.name.getText(source);
      const params = member.parameters ? formatParams(member.parameters, source) : '';
      const returns = typeToString(member.type, source) || 'void';
      const funcType = `(${params}) => ${returns}`;
      const optional = member.questionToken ? ' optional=true' : '';
      lines.push(`  field name=${methodName} type="${escapeKernString(funcType)}"${optional}`);
    }
  }

  return lines;
}

function convertEnum(node: ts.EnumDeclaration, source: ts.SourceFile): string[] {
  const lines: string[] = [];
  const name = node.name.getText(source);
  const exp = isExported(node) ? ' export=true' : '';
  const doc = getJSDoc(node, source);

  if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

  // Check if all members are string literals → type with values
  const allString = node.members.every(
    (m) => m.initializer && ts.isStringLiteral(m.initializer),
  );

  if (allString) {
    const values = node.members
      .map((m) => (m.initializer as ts.StringLiteral).text)
      .join('|');
    lines.push(`type name=${name} values="${values}"${exp}`);
  } else {
    // Numeric or mixed enum → type alias
    const values = node.members.map((m) => m.name.getText(source)).join('|');
    lines.push(`type name=${name} values="${values}"${exp}`);
  }

  return lines;
}

function convertFunction(
  node: ts.FunctionDeclaration,
  source: ts.SourceFile,
): string[] {
  const lines: string[] = [];
  const name = node.name?.getText(source) ?? 'anonymous';
  const exp = isExported(node) ? ' export=true' : '';
  const doc = getJSDoc(node, source);
  const asyncStr = isAsync(node) ? ' async=true' : '';
  const isGenerator = node.asteriskToken != null;
  const generatorStr = isGenerator ? (isAsync(node) ? ' stream=true' : ' generator=true') : '';

  if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

  const params = formatParams(node.parameters, source);
  const returns = typeToString(node.type, source);
  const paramsStr = params ? ` params="${params}"` : '';
  const returnsStr = returns ? ` returns=${returns}` : '';

  // For async generators, use stream=true instead of async=true + generator=true
  const asyncFinal = isGenerator && isAsync(node) ? '' : asyncStr;

  lines.push(`fn name=${name}${paramsStr}${returnsStr}${asyncFinal}${generatorStr}${exp}`);

  const body = getBodyText(node.body, source);
  if (body) {
    lines.push('  handler <<<');
    for (const bodyLine of body.split('\n')) {
      lines.push(`    ${bodyLine}`);
    }
    lines.push('  >>>');
  }

  return lines;
}

function convertClass(node: ts.ClassDeclaration, source: ts.SourceFile): string[] {
  const lines: string[] = [];
  const name = node.name?.getText(source) ?? 'AnonymousClass';
  const exp = isExported(node) ? ' export=true' : '';
  const doc = getJSDoc(node, source);

  // Check if it extends Error → error node
  const extendsClause = node.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const baseClass = extendsClause?.types[0]?.getText(source);
  const isError = baseClass && (baseClass === 'Error' || baseClass.endsWith('Error'));

  if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

  if (isError) {
    return convertErrorClass(node, source, name, baseClass!, exp, lines);
  }

  // Regular class → service
  const implementsClause = node.heritageClauses?.find(
    (h) => h.token === ts.SyntaxKind.ImplementsKeyword,
  );
  const implementsStr = implementsClause
    ? ` implements=${implementsClause.types.map((t) => t.getText(source)).join(',')}`
    : '';

  lines.push(`service name=${name}${implementsStr}${exp}`);

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      const fieldName = member.name.getText(source);
      const fieldType = typeToString(member.type, source);
      const priv = isPrivate(member) ? ' private=true' : '';
      const ro = isReadonly(member) ? ' readonly=true' : '';
      const defaultVal = member.initializer ? ` default=${member.initializer.getText(source)}` : '';
      const memberDoc = getJSDoc(member, source);
      if (memberDoc) lines.push(`  doc text="${escapeKernString(memberDoc)}"`);
      lines.push(`  field name=${fieldName}${fieldType ? ` type=${fieldType}` : ''}${priv}${ro}${defaultVal}`);
    } else if (ts.isConstructorDeclaration(member)) {
      lines.push('  constructor');
      const body = getBodyText(member.body, source);
      if (body) {
        lines.push('    handler <<<');
        for (const bodyLine of body.split('\n')) {
          lines.push(`      ${bodyLine}`);
        }
        lines.push('    >>>');
      }
    } else if (ts.isMethodDeclaration(member)) {
      const methodName = member.name.getText(source);
      const params = formatParams(member.parameters, source);
      const returns = typeToString(member.type, source);
      const asyncStr = isAsync(member) ? ' async=true' : '';
      const staticStr = isStatic(member) ? ' static=true' : '';
      const privStr = isPrivate(member) ? ' private=true' : '';
      const paramsStr = params ? ` params="${params}"` : '';
      const returnsStr = returns ? ` returns=${returns}` : '';
      const memberDoc = getJSDoc(member, source);
      if (memberDoc) lines.push(`  doc text="${escapeKernString(memberDoc)}"`);
      lines.push(`  method name=${methodName}${paramsStr}${returnsStr}${asyncStr}${staticStr}${privStr}`);
      const body = getBodyText(member.body, source);
      if (body) {
        lines.push('    handler <<<');
        for (const bodyLine of body.split('\n')) {
          lines.push(`      ${bodyLine}`);
        }
        lines.push('    >>>');
      }
    }
  }

  return lines;
}

function convertErrorClass(
  node: ts.ClassDeclaration,
  source: ts.SourceFile,
  name: string,
  baseClass: string,
  exp: string,
  lines: string[],
): string[] {
  // Find constructor to extract message
  const ctor = node.members.find(ts.isConstructorDeclaration);
  let message = '';

  if (ctor) {
    // Look for super() call to extract message
    const superCall = ctor.body?.statements.find(
      (s) =>
        ts.isExpressionStatement(s) &&
        ts.isCallExpression(s.expression) &&
        s.expression.expression.kind === ts.SyntaxKind.SuperKeyword,
    );
    if (superCall && ts.isExpressionStatement(superCall)) {
      const call = superCall.expression as ts.CallExpression;
      if (call.arguments.length > 0) {
        message = call.arguments[0].getText(source);
      }
    }
  }

  const messageStr = message ? ` message="${escapeKernString(message)}"` : '';
  lines.push(`error name=${name} extends=${baseClass}${messageStr}${exp}`);

  // Add fields (constructor params that are public)
  if (ctor) {
    for (const param of ctor.parameters) {
      const modifiers = ts.canHaveModifiers(param) ? ts.getModifiers(param) : undefined;
      const isPublicOrReadonly = modifiers?.some(
        (m) =>
          m.kind === ts.SyntaxKind.PublicKeyword ||
          m.kind === ts.SyntaxKind.ReadonlyKeyword,
      );
      if (isPublicOrReadonly) {
        const fieldName = param.name.getText(source);
        const fieldType = typeToString(param.type, source);
        lines.push(`  field name=${fieldName}${fieldType ? ` type=${fieldType}` : ''}`);
      }
    }
  }

  return lines;
}

function convertVariableStatement(
  node: ts.VariableStatement,
  source: ts.SourceFile,
): string[] {
  const lines: string[] = [];
  const exp = isExported(node) ? ' export=true' : '';
  const doc = getJSDoc(node, source);

  for (const decl of node.declarationList.declarations) {
    const name = decl.name.getText(source);
    const type = typeToString(decl.type, source);
    const typeStr = type ? ` type=${type}` : '';

    if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

    if (decl.initializer) {
      // Check if it's a simple value (number, string, boolean, etc.)
      const initText = decl.initializer.getText(source);
      const isSimple =
        ts.isNumericLiteral(decl.initializer) ||
        ts.isStringLiteral(decl.initializer) ||
        decl.initializer.kind === ts.SyntaxKind.TrueKeyword ||
        decl.initializer.kind === ts.SyntaxKind.FalseKeyword ||
        decl.initializer.kind === ts.SyntaxKind.NullKeyword;

      if (isSimple) {
        lines.push(`const name=${name}${typeStr} value=${initText}${exp}`);
      } else if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
        // Arrow function or function expression → fn
        const func = decl.initializer;
        const asyncStr = isAsync(func as any) ? ' async=true' : '';
        const params = formatParams(func.parameters, source);
        const returns = typeToString(func.type, source);
        const paramsStr = params ? ` params="${params}"` : '';
        const returnsStr = returns ? ` returns=${returns}` : '';
        const isGen =
          ts.isFunctionExpression(func) && func.asteriskToken != null;
        const genStr = isGen ? (isAsync(func as any) ? ' stream=true' : ' generator=true') : '';
        const asyncFinal = isGen && isAsync(func as any) ? '' : asyncStr;

        lines.push(`fn name=${name}${paramsStr}${returnsStr}${asyncFinal}${genStr}${exp}`);
        const body = ts.isArrowFunction(func)
          ? getBodyText(func.body as ts.Block | ts.Expression, source)
          : getBodyText(func.body, source);
        if (body) {
          lines.push('  handler <<<');
          for (const bodyLine of body.split('\n')) {
            lines.push(`    ${bodyLine}`);
          }
          lines.push('  >>>');
        }
      } else {
        // Complex initializer → const with handler
        lines.push(`const name=${name}${typeStr}${exp}`);
        lines.push('  handler <<<');
        for (const initLine of initText.split('\n')) {
          lines.push(`    ${initLine}`);
        }
        lines.push('  >>>');
      }
    } else {
      lines.push(`const name=${name}${typeStr}${exp}`);
    }
  }

  return lines;
}

// ── Tailwind → KERN style reverse mapping ───────────────────────────────

const TW_TO_KERN_STYLE: Record<string, [string, string]> = {
  // Flexbox
  flex: ['fd', 'row'],
  'flex-col': ['fd', 'column'],
  'flex-row': ['fd', 'row'],
  'items-center': ['ai', 'center'],
  'items-start': ['ai', 'start'],
  'items-end': ['ai', 'end'],
  'items-stretch': ['ai', 'stretch'],
  'justify-center': ['jc', 'center'],
  'justify-between': ['jc', 'sb'],
  'justify-around': ['jc', 'sa'],
  'justify-evenly': ['jc', 'se'],
  'justify-start': ['jc', 'start'],
  'justify-end': ['jc', 'end'],
  // Font
  'font-bold': ['fw', 'bold'],
  'font-semibold': ['fw', '600'],
  'font-medium': ['fw', '500'],
  'font-normal': ['fw', '400'],
  'font-light': ['fw', '300'],
  'text-center': ['ta', 'center'],
  'text-left': ['ta', 'left'],
  'text-right': ['ta', 'right'],
  // Width/height
  'w-full': ['w', 'full'],
  'h-full': ['h', 'full'],
};

/** Match spacing utilities: p-4, px-2, mt-8, gap-4, etc. */
const TW_SPACING_RE = /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap)-(\d+)$/;
/** Match text size: text-sm, text-lg, text-xl, text-2xl */
const TW_TEXTSIZE_RE = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)$/;
/** Match rounded: rounded, rounded-md, rounded-lg, rounded-full */
const TW_ROUNDED_RE = /^rounded(?:-(sm|md|lg|xl|2xl|full|none))?$/;
/** Match bg/text colors: bg-blue-500, text-gray-700 */
const TW_COLOR_RE = /^(bg|text|border)-([a-z]+-\d+|white|black|transparent)$/;

function parseTailwindClasses(className: string): { styles: Record<string, string>; remaining: string[] } {
  const styles: Record<string, string> = {};
  const remaining: string[] = [];

  for (const cls of className.split(/\s+/).filter(Boolean)) {
    const known = TW_TO_KERN_STYLE[cls];
    if (known) {
      styles[known[0]] = known[1];
      continue;
    }

    const spacingMatch = cls.match(TW_SPACING_RE);
    if (spacingMatch) {
      const prop = spacingMatch[1] === 'gap' ? 'gap' : spacingMatch[1];
      styles[prop] = spacingMatch[2];
      continue;
    }

    const textMatch = cls.match(TW_TEXTSIZE_RE);
    if (textMatch) {
      const sizes: Record<string, string> = { xs: '12', sm: '14', base: '16', lg: '18', xl: '20', '2xl': '24', '3xl': '30', '4xl': '36', '5xl': '48' };
      styles.fs = sizes[textMatch[1]] || textMatch[1];
      continue;
    }

    const roundedMatch = cls.match(TW_ROUNDED_RE);
    if (roundedMatch) {
      const vals: Record<string, string> = { sm: '2', md: '6', lg: '8', xl: '12', '2xl': '16', full: '9999', none: '0' };
      styles.br = vals[roundedMatch[1] ?? 'md'] ?? '4';
      continue;
    }

    const colorMatch = cls.match(TW_COLOR_RE);
    if (colorMatch) {
      const prop = colorMatch[1] === 'bg' ? 'bg' : colorMatch[1] === 'text' ? 'c' : 'bc';
      styles[prop] = colorMatch[2];
      continue;
    }

    remaining.push(cls);
  }

  return { styles, remaining };
}

function formatKernStyles(styles: Record<string, string>): string {
  if (Object.keys(styles).length === 0) return '';
  return ' {' + Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(', ') + '}';
}

// ── JSX → KERN conversion ───────────────────────────────────────────────

/** Map HTML/React element tags to KERN node types */
const JSX_TAG_MAP: Record<string, string> = {
  div: 'row',
  span: 'text',
  p: 'text',
  h1: 'text',
  h2: 'text',
  h3: 'text',
  h4: 'text',
  h5: 'text',
  h6: 'text',
  button: 'button',
  input: 'input',
  textarea: 'textarea',
  img: 'image',
  a: 'link',
  form: 'form',
  section: 'section',
  nav: 'header',
  header: 'header',
  footer: 'section',
  ul: 'list',
  ol: 'list',
  li: 'item',
  table: 'table',
  tr: 'tr',
  th: 'th',
  td: 'td',
  select: 'select',
  option: 'option',
  label: 'text',
  main: 'section',
  article: 'card',
  aside: 'section',
  modal: 'modal',
};

function convertJsxElement(node: ts.Node, source: ts.SourceFile, depth: number): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(depth);

  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName.getText(source);
    const attrs = node.openingElement.attributes;
    lines.push(...convertJsxTag(tag, attrs, node.children, source, depth));
  } else if (ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText(source);
    const attrs = node.attributes;
    lines.push(...convertJsxTag(tag, attrs, [], source, depth));
  } else if (ts.isJsxExpression(node)) {
    if (node.expression) {
      // {variable} → text expression
      // {cond && <el>} → conditional
      // {items.map(i => <el>)} → each
      if (ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        // {show && <Component>} → conditional
        const condition = node.expression.left.getText(source);
        lines.push(`${prefix}conditional expr="${escapeKernString(condition)}"`);
        const right = node.expression.right;
        if (ts.isJsxElement(right) || ts.isJsxSelfClosingElement(right) || ts.isParenthesizedExpression(right)) {
          const inner = ts.isParenthesizedExpression(right) ? right.expression : right;
          lines.push(...convertJsxElement(inner, source, depth + 1));
        }
      } else if (ts.isCallExpression(node.expression)) {
        // Check for .map() pattern → each
        const callText = node.expression.getText(source);
        if (ts.isPropertyAccessExpression(node.expression.expression) &&
            node.expression.expression.name.getText(source) === 'map') {
          const collection = node.expression.expression.expression.getText(source);
          const callback = node.expression.arguments[0];
          if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            const paramName = callback.parameters[0]?.name.getText(source) ?? 'item';
            const indexParam = callback.parameters[1]?.name.getText(source);
            const indexStr = indexParam ? ` index=${indexParam}` : '';
            lines.push(`${prefix}each name=${paramName} in=${collection}${indexStr}`);
            // Convert the body
            const body = callback.body;
            if (ts.isBlock(body)) {
              // Block body with return
              for (const stmt of body.statements) {
                if (ts.isReturnStatement(stmt) && stmt.expression) {
                  if (ts.isParenthesizedExpression(stmt.expression)) {
                    lines.push(...convertJsxElement(stmt.expression.expression, source, depth + 1));
                  } else {
                    lines.push(...convertJsxElement(stmt.expression, source, depth + 1));
                  }
                }
              }
            } else if (ts.isParenthesizedExpression(body)) {
              lines.push(...convertJsxElement(body.expression, source, depth + 1));
            } else if (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body)) {
              lines.push(...convertJsxElement(body, source, depth + 1));
            }
          } else {
            lines.push(`${prefix}// {${callText.slice(0, 60)}}`);
          }
        } else {
          lines.push(`${prefix}// {${callText.slice(0, 60)}}`);
        }
      } else if (ts.isConditionalExpression(node.expression)) {
        // {cond ? <A> : <B>} → branch
        const condition = node.expression.condition.getText(source);
        lines.push(`${prefix}branch name=cond on="${escapeKernString(condition)}"`);
        lines.push(`${prefix}  path value=true`);
        const whenTrue = ts.isParenthesizedExpression(node.expression.whenTrue)
          ? node.expression.whenTrue.expression : node.expression.whenTrue;
        lines.push(...convertJsxElement(whenTrue, source, depth + 2));
        lines.push(`${prefix}  path value=false`);
        const whenFalse = ts.isParenthesizedExpression(node.expression.whenFalse)
          ? node.expression.whenFalse.expression : node.expression.whenFalse;
        lines.push(...convertJsxElement(whenFalse, source, depth + 2));
      } else {
        // Simple expression: {variable} or {expr}
        const expr = node.expression.getText(source);
        lines.push(`${prefix}text @{${expr}}`);
      }
    }
  } else if (ts.isJsxText(node)) {
    const text = node.getText(source).trim();
    if (text) {
      lines.push(`${prefix}text "${escapeKernString(text)}"`);
    }
  } else if (ts.isJsxFragment(node)) {
    // <> ... </> → just process children
    for (const child of node.children) {
      lines.push(...convertJsxElement(child, source, depth));
    }
  }

  return lines;
}

function convertJsxTag(
  tag: string,
  attrs: ts.JsxAttributes,
  children: ts.NodeArray<ts.JsxChild> | ts.JsxChild[],
  source: ts.SourceFile,
  depth: number,
): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(depth);
  const kernTag = JSX_TAG_MAP[tag];

  // Extract props
  let className = '';
  let styleStr = '';
  const props: string[] = [];
  const events: { event: string; handler: string }[] = [];

  for (const attr of attrs.properties) {
    if (ts.isJsxAttribute(attr)) {
      const attrName = attr.name.getText(source);
      const attrValue = attr.initializer;

      if (attrName === 'className' || attrName === 'class') {
        if (attrValue && ts.isStringLiteral(attrValue)) {
          className = attrValue.text;
        } else if (attrValue && ts.isJsxExpression(attrValue) && attrValue.expression) {
          className = attrValue.expression.getText(source);
        }
        continue;
      }

      if (attrName.startsWith('on') && attrName.length > 2) {
        const eventName = attrName.slice(2).toLowerCase();
        let handlerText = '';
        if (attrValue && ts.isJsxExpression(attrValue) && attrValue.expression) {
          handlerText = attrValue.expression.getText(source);
        }
        events.push({ event: eventName, handler: handlerText });
        continue;
      }

      // Regular props
      if (attrValue) {
        if (ts.isStringLiteral(attrValue)) {
          props.push(`${attrName}="${attrValue.text}"`);
        } else if (ts.isJsxExpression(attrValue) && attrValue.expression) {
          props.push(`${attrName}=${attrValue.expression.getText(source)}`);
        }
      } else {
        // Boolean prop: <input disabled />
        props.push(`${attrName}=true`);
      }
    }
  }

  // Parse Tailwind classes → KERN styles
  let kernStyles = '';
  let remainingClasses: string[] = [];
  if (className && !className.includes('`') && !className.includes('$')) {
    const parsed = parseTailwindClasses(className);
    kernStyles = formatKernStyles(parsed.styles);
    remainingClasses = parsed.remaining;
  }

  if (kernTag) {
    // Known HTML tag → KERN node
    let line = `${prefix}${kernTag}`;

    // Special prop handling per tag
    if (kernTag === 'link' && props.some((p) => p.startsWith('href='))) {
      const href = props.find((p) => p.startsWith('href='));
      if (href) line += ` to=${href.slice(5)}`;
    } else if (kernTag === 'input') {
      const valueProp = props.find((p) => p.startsWith('value='));
      if (valueProp) line += ` bind=${valueProp.slice(6)}`;
      const placeholder = props.find((p) => p.startsWith('placeholder='));
      if (placeholder) line += ` ${placeholder}`;
    } else if (kernTag === 'image') {
      const src = props.find((p) => p.startsWith('src='));
      if (src) line += ` ${src}`;
      const alt = props.find((p) => p.startsWith('alt='));
      if (alt) line += ` ${alt}`;
    }

    line += kernStyles;
    if (remainingClasses.length > 0) {
      line += ` // tw: ${remainingClasses.join(' ')}`;
    }
    lines.push(line);
  } else if (tag[0] === tag[0].toUpperCase()) {
    // PascalCase → component reference
    let line = `${prefix}component ref=${tag}`;
    const propNames = props.map((p) => p.split('=')[0]);
    if (propNames.length > 0) line += ` props="${propNames.join(',')}"`;
    line += kernStyles;
    lines.push(line);
  } else {
    // Unknown tag → row with comment
    lines.push(`${prefix}row // <${tag}>${kernStyles}`);
  }

  // Add events
  for (const { event, handler } of events) {
    if (ts.isIdentifier(ts.factory.createIdentifier(handler)) && /^[a-zA-Z_]\w*$/.test(handler)) {
      lines.push(`${prefix}  on event=${event} handler=${handler}`);
    } else if (handler) {
      lines.push(`${prefix}  on event=${event}`);
      lines.push(`${prefix}    handler <<<`);
      lines.push(`${prefix}      ${handler}`);
      lines.push(`${prefix}    >>>`);
    }
  }

  // Process children
  for (const child of children) {
    lines.push(...convertJsxElement(child, source, depth + 1));
  }

  return lines;
}

// ── React hook detection ────────────────────────────────────────────────

interface HookInfo {
  type: 'state' | 'effect' | 'memo' | 'callback' | 'ref';
  name?: string;
  init?: string;
  typeName?: string;
  deps?: string;
  body?: string;
  cleanup?: string;
}

function extractHooks(body: ts.Block, source: ts.SourceFile): { hooks: HookInfo[]; remainingStatements: ts.Statement[] } {
  const hooks: HookInfo[] = [];
  const remaining: ts.Statement[] = [];

  for (const stmt of body.statements) {
    const hook = tryExtractHook(stmt, source);
    if (hook) {
      hooks.push(hook);
    } else {
      remaining.push(stmt);
    }
  }

  return { hooks, remainingStatements: remaining };
}

function tryExtractHook(stmt: ts.Statement, source: ts.SourceFile): HookInfo | null {
  // useState: const [x, setX] = useState<T>(init)
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (decl.initializer && ts.isCallExpression(decl.initializer)) {
        const callName = decl.initializer.expression.getText(source);

        if (callName === 'useState') {
          const init = decl.initializer.arguments[0]?.getText(source) ?? '';
          let name = '';
          if (ts.isArrayBindingPattern(decl.name)) {
            name = decl.name.elements[0]?.getText(source) ?? '';
          } else {
            name = decl.name.getText(source);
          }
          const typeArg = decl.initializer.typeArguments?.[0];
          const typeName = typeArg ? typeToString(typeArg, source) : '';
          return { type: 'state', name, init, typeName };
        }

        if (callName === 'useRef') {
          const init = decl.initializer.arguments[0]?.getText(source) ?? '';
          const name = decl.name.getText(source);
          return { type: 'ref', name, init };
        }

        if (callName === 'useMemo') {
          const name = decl.name.getText(source);
          const callback = decl.initializer.arguments[0];
          const depsArg = decl.initializer.arguments[1];
          const deps = depsArg ? depsArg.getText(source).replace(/^\[|\]$/g, '') : '';
          let bodyText = '';
          if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            bodyText = getBodyText(callback.body as ts.Block | ts.Expression, source) ?? '';
          }
          return { type: 'memo', name, deps, body: bodyText };
        }

        if (callName === 'useCallback') {
          const name = decl.name.getText(source);
          const callback = decl.initializer.arguments[0];
          const depsArg = decl.initializer.arguments[1];
          const deps = depsArg ? depsArg.getText(source).replace(/^\[|\]$/g, '') : '';
          let bodyText = '';
          if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
            bodyText = getBodyText(callback.body as ts.Block | ts.Expression, source) ?? '';
          }
          return { type: 'callback', name, deps, body: bodyText };
        }
      }
    }
  }

  // useEffect: useEffect(() => { ... }, [deps])
  if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression)) {
    const callName = stmt.expression.expression.getText(source);
    if (callName === 'useEffect') {
      const callback = stmt.expression.arguments[0];
      const depsArg = stmt.expression.arguments[1];
      const deps = depsArg ? depsArg.getText(source).replace(/^\[|\]$/g, '') : '';
      let bodyText = '';
      let cleanupText = '';

      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        if (ts.isBlock(callback.body)) {
          // Check for cleanup return
          const lastStmt = callback.body.statements[callback.body.statements.length - 1];
          if (lastStmt && ts.isReturnStatement(lastStmt) && lastStmt.expression) {
            // Return of arrow/function = cleanup
            cleanupText = lastStmt.expression.getText(source);
            if (ts.isArrowFunction(lastStmt.expression) || ts.isFunctionExpression(lastStmt.expression)) {
              cleanupText = getBodyText(
                (lastStmt.expression as ts.ArrowFunction).body as ts.Block | ts.Expression,
                source,
              ) ?? '';
            }
            // Body is everything except the return
            const bodyStmts = callback.body.statements.slice(0, -1);
            bodyText = bodyStmts.map((s) => s.getText(source)).join('\n');
          } else {
            bodyText = getBodyText(callback.body, source) ?? '';
          }
        } else {
          bodyText = callback.body.getText(source);
        }
      }

      const once = deps === '' && depsArg ? true : false;
      return { type: 'effect', deps: once ? undefined : deps || undefined, body: bodyText, cleanup: cleanupText || undefined };
    }
  }

  return null;
}

function emitHooks(hooks: HookInfo[], depth: number): string[] {
  const lines: string[] = [];
  const prefix = '  '.repeat(depth);

  for (const hook of hooks) {
    switch (hook.type) {
      case 'state': {
        let line = `${prefix}// state: ${hook.name}`;
        if (hook.typeName) line += ` (${hook.typeName})`;
        if (hook.init) line += ` = ${hook.init}`;
        lines.push(line);
        break;
      }
      case 'ref':
        lines.push(`${prefix}ref name=${hook.name}${hook.init ? ` default=${hook.init}` : ''}`);
        break;
      case 'effect': {
        let line = `${prefix}effect`;
        if (hook.deps) line += ` deps="${hook.deps}"`;
        if (hook.deps === undefined && !hook.body) line += ' once=true';
        lines.push(line);
        if (hook.body) {
          lines.push(`${prefix}  handler <<<`);
          for (const l of hook.body.split('\n')) {
            lines.push(`${prefix}    ${l}`);
          }
          lines.push(`${prefix}  >>>`);
        }
        if (hook.cleanup) {
          lines.push(`${prefix}  cleanup <<<`);
          for (const l of hook.cleanup.split('\n')) {
            lines.push(`${prefix}    ${l}`);
          }
          lines.push(`${prefix}  >>>`);
        }
        break;
      }
      case 'memo':
        lines.push(`${prefix}memo name=${hook.name}${hook.deps ? ` deps="${hook.deps}"` : ''}`);
        if (hook.body) {
          lines.push(`${prefix}  handler <<<`);
          for (const l of hook.body.split('\n')) {
            lines.push(`${prefix}    ${l}`);
          }
          lines.push(`${prefix}  >>>`);
        }
        break;
      case 'callback':
        lines.push(`${prefix}callback name=${hook.name}${hook.deps ? ` deps="${hook.deps}"` : ''}`);
        if (hook.body) {
          lines.push(`${prefix}  handler <<<`);
          for (const l of hook.body.split('\n')) {
            lines.push(`${prefix}    ${l}`);
          }
          lines.push(`${prefix}  >>>`);
        }
        break;
    }
  }

  return lines;
}

// ── React component detection & conversion ──────────────────────────────

function returnsJsx(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression, source: ts.SourceFile): boolean {
  if (!node.body) return false;

  // Check return type annotation
  const returnType = node.type ? typeToString(node.type, source) : '';
  if (returnType.includes('JSX') || returnType.includes('ReactNode') || returnType.includes('ReactElement')) return true;

  // Walk body for JSX returns
  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node.body);
  return found;
}

function convertReactComponent(
  name: string,
  params: string,
  body: ts.Block,
  source: ts.SourceFile,
  exp: string,
  doc: string | undefined,
  isAsync_: boolean,
): string[] {
  const lines: string[] = [];
  if (doc) lines.push(`doc text="${escapeKernString(doc)}"`);

  const asyncStr = isAsync_ ? ' async=true' : '';
  const isPage = name.endsWith('Page') || name.endsWith('Layout') || name === 'default' ||
    name === 'Home' || name === 'Dashboard' || name === 'App';
  const nodeType = isPage ? 'page' : 'screen';

  lines.push(`${nodeType} name=${name}${asyncStr}${exp}`);

  // Extract hooks
  const { hooks, remainingStatements } = extractHooks(body, source);
  lines.push(...emitHooks(hooks, 1));

  // Find the return statement with JSX
  for (const stmt of remainingStatements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      let jsxRoot = stmt.expression;
      if (ts.isParenthesizedExpression(jsxRoot)) jsxRoot = jsxRoot.expression;
      lines.push(...convertJsxElement(jsxRoot, source, 1));
    } else {
      // Non-return, non-hook logic → logic block
      const text = stmt.getText(source);
      if (text.trim()) {
        lines.push(`  logic <<<`);
        lines.push(`    ${text}`);
        lines.push(`  >>>`);
      }
    }
  }

  return lines;
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Import TypeScript source code and produce .kern output.
 *
 * Recognizes: imports, type aliases, interfaces, enums, functions, classes (→ service/error), constants.
 * Function/method bodies become <<<>>> handler blocks.
 * JSDoc comments become doc nodes.
 *
 * @param tsSource - TypeScript source code
 * @param fileName - Optional filename for better error messages
 */
export function importTypeScript(tsSource: string, fileName = 'input.ts'): ImportResult {
  const isTsx = fileName.endsWith('.tsx') || tsSource.includes('React') || /<[A-Z]/.test(tsSource);
  const scriptKind = isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, tsSource, ts.ScriptTarget.Latest, true, scriptKind);

  const kernLines: string[] = [];
  const unmapped: string[] = [];
  const stats = { types: 0, interfaces: 0, functions: 0, classes: 0, imports: 0, constants: 0, enums: 0, components: 0 };

  for (const statement of sourceFile.statements) {
    const converted = convertStatement(statement, sourceFile, unmapped, stats);
    if (converted.length > 0) {
      kernLines.push(...converted);
      kernLines.push(''); // blank line between top-level nodes
    }
  }

  return {
    kern: kernLines.join('\n').trimEnd() + '\n',
    unmapped,
    stats,
  };
}

function convertStatement(
  node: ts.Statement,
  source: ts.SourceFile,
  unmapped: string[],
  stats: ImportResult['stats'],
): string[] {
  // Skip 'use client' / 'use server' directives
  if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) {
    return [`// ${node.expression.text}`];
  }

  if (ts.isImportDeclaration(node)) {
    stats.imports++;
    return convertImport(node, source);
  }

  if (ts.isTypeAliasDeclaration(node)) {
    stats.types++;
    return convertTypeAlias(node, source);
  }

  if (ts.isInterfaceDeclaration(node)) {
    stats.interfaces++;
    return convertInterface(node, source);
  }

  if (ts.isEnumDeclaration(node)) {
    stats.enums++;
    return convertEnum(node, source);
  }

  if (ts.isFunctionDeclaration(node)) {
    // Check if it's a React component (returns JSX)
    if (node.name && /^[A-Z]/.test(node.name.getText(source)) && returnsJsx(node, source)) {
      stats.components++;
      const name = node.name.getText(source);
      const params = formatParams(node.parameters, source);
      const exp = isExported(node) ? ' export=true' : '';
      const doc = getJSDoc(node, source);
      return convertReactComponent(name, params, node.body!, source, exp, doc, isAsync(node));
    }
    stats.functions++;
    return convertFunction(node, source);
  }

  if (ts.isClassDeclaration(node)) {
    stats.classes++;
    return convertClass(node, source);
  }

  if (ts.isVariableStatement(node)) {
    // Check for arrow function React components: const MyComponent = (props) => { return <div>... }
    for (const decl of node.declarationList.declarations) {
      const name = decl.name.getText(source);
      if (/^[A-Z]/.test(name) && decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
        const func = decl.initializer;
        if (returnsJsx(func as any, source)) {
          stats.components++;
          const exp = isExported(node) ? ' export=true' : '';
          const doc = getJSDoc(node, source);
          const arrowBody = (func as ts.ArrowFunction).body;
          if (ts.isBlock(arrowBody)) {
            return convertReactComponent(name, formatParams(func.parameters, source),
              arrowBody, source, exp, doc, isAsync(func as any));
          }
          // Expression-bodied: const Foo = () => <div>...</div>
          // Wrap in a synthetic block for the component converter
          const jsxLines: string[] = [];
          if (doc) jsxLines.push(`doc text="${escapeKernString(doc)}"`);
          const asyncStr = isAsync(func as any) ? ' async=true' : '';
          const isPage_ = name.endsWith('Page') || name.endsWith('Layout') || name === 'default' ||
            name === 'Home' || name === 'Dashboard' || name === 'App';
          jsxLines.push(`${isPage_ ? 'page' : 'screen'} name=${name}${asyncStr}${exp}`);
          jsxLines.push(...convertJsxElement(arrowBody, source, 1));
          return jsxLines;
        }
      }
    }
    stats.constants++;
    return convertVariableStatement(node, source);
  }

  // Export default function/class
  if (ts.isExportAssignment(node)) {
    const text = node.expression.getText(source);
    return [`// export default ${text}`];
  }

  // Re-exports: export { X } from './y'
  if (ts.isExportDeclaration(node)) {
    const moduleSpec = node.moduleSpecifier?.getText(source).replace(/['"]/g, '');
    if (moduleSpec && node.exportClause && ts.isNamedExports(node.exportClause)) {
      const names = node.exportClause.elements.map((e) => e.getText(source)).join(',');
      return [`import from="${moduleSpec}" names="${names}"`];
    }
    if (moduleSpec) {
      return [`// export * from "${moduleSpec}"`];
    }
    return [];
  }

  // Unmapped
  const text = node.getText(source).slice(0, 80);
  unmapped.push(`Line ${getLineNumber(node, source)}: ${text}${text.length >= 80 ? '...' : ''}`);
  return [`// [unmapped] ${text.split('\n')[0]}`];
}

function getLineNumber(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}
