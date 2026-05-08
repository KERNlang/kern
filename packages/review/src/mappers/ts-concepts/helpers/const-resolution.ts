import { type SourceFile, SyntaxKind, VariableDeclarationKind } from 'ts-morph';

// ── Const literal resolution (phase-1 IR depth) ─────────────────────────
//
// Real-world cross-stack URLs hide behind module-level constants:
//   const API_BASE = 'https://api.example.com';
//   fetch(`${API_BASE}/users/${id}`)
//
// Without resolution, `extractTarget` sees a TemplateExpression with a bare
// `API_BASE` identifier, drops the head (looksLikeBaseUrlName), and degrades
// to `/users/:id`. Host extraction silently fails. Probe on audiofacets
// (~939 files, ~48 fetch call-sites): only ~8% had `host` populated.
//
// This pass collects every same-file `const X = <literal>` declaration into
// a `VariableDeclaration → literal` map. Lookup at use-sites is **symbol-
// based**, not name-based: we ask ts-morph for the identifier's binding
// (`getSymbol().getDeclarations()`) and only resolve if that binding is one
// of the declarations we collected. This is the FP gate against shadowing —
// a parameter or inner non-literal `const` with the same text would
// otherwise fabricate a wrong host/target. (Codex review 2026-05-04 caught
// the original name-keyed implementation as unsound; this is the fix.)
//
// Two passes:
//   - pass 1: direct string / no-substitution-template literal initializers
//   - pass 2: template-with-refs (\`\${A}/...\`) where each `${IDENT}`
//             resolves via symbol to a pass-1 declaration. One hop only.
//
// Out-of-scope for phase 1 (deliberate):
//   - Cross-file imports.
//   - Object property destructuring (`const { url } = config`).
//   - Conditional expressions (`const X = cond ? a : b`).
//   - Function-call initializers other than no-sub templates.
// Map key: declaration's source-file path + AST start offset. Stable across
// AST walks (ts-morph node identity is not always reference-stable when the
// node is re-fetched via a different traversal).
export type ConstLiteralMap = ReadonlyMap<string, string>;

export function declKey(decl: import('ts-morph').VariableDeclaration): string {
  return `${decl.getSourceFile().getFilePath()}:${decl.getStart()}`;
}

// Extract a literal string from a const initializer. Handles:
//   const X = 'lit';
//   const X = `lit`;                                 (no substitutions)
//   const X = process.env.FOO || 'fallback';         (env-with-fallback)
//   const X = process.env.FOO ?? 'fallback';         (nullish-coalescing)
//
// The `||` / `??` fallback case is the dominant real-world shape — audiofacets
// has 10+ `const API_URL = process.env.X || "https://..."` sites that the
// pure-literal collector silently dropped. Resolution captures the FALLBACK
// branch as the "no-env-set" value. At runtime when env IS set the URL
// differs, but for cross-stack matching the path part is identical and
// `host` is "best effort, stay silent if not absolute" anyway.
//
// Conservative: only the right-hand side of `||`/`??` is taken as the literal.
// Chained `a || b || 'lit'` bails (right is BinaryExpression, not literal).
// Ternaries and other shapes stay out of scope.
export function literalStringFromInit(init: import('ts-morph').Node): string | undefined {
  if (init.getKind() === SyntaxKind.StringLiteral) {
    return (init as import('ts-morph').StringLiteral).getLiteralValue();
  }
  if (init.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return (init as import('ts-morph').NoSubstitutionTemplateLiteral).getLiteralValue();
  }
  if (init.getKind() === SyntaxKind.BinaryExpression) {
    const bin = init as import('ts-morph').BinaryExpression;
    const op = bin.getOperatorToken().getKind();
    if (op === SyntaxKind.BarBarToken || op === SyntaxKind.QuestionQuestionToken) {
      const right = bin.getRight();
      if (right.getKind() === SyntaxKind.StringLiteral) {
        return (right as import('ts-morph').StringLiteral).getLiteralValue();
      }
      if (right.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return (right as import('ts-morph').NoSubstitutionTemplateLiteral).getLiteralValue();
      }
    }
  }
  return undefined;
}

export function buildConstLiteralMap(sf: SourceFile): ConstLiteralMap {
  const candidates: Array<{
    decl: import('ts-morph').VariableDeclaration;
    key: string;
    init: import('ts-morph').Node;
  }> = [];
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const stmt = decl.getVariableStatement();
    if (!stmt) continue;
    if (stmt.getDeclarationKind() !== VariableDeclarationKind.Const) continue;
    if (decl.getNameNode().getKind() !== SyntaxKind.Identifier) continue; // skip destructure
    const init = decl.getInitializer();
    if (!init) continue;
    candidates.push({ decl, key: declKey(decl), init });
  }

  const direct = new Map<string, string>();
  for (const { key, init } of candidates) {
    const lit = literalStringFromInit(init);
    if (lit !== undefined) direct.set(key, lit);
  }

  // Pass 2: template-with-refs against pass 1. One hop — no transitive
  // resolution. A `const A = \`\${B}/x\`` whose `B` is itself a
  // template-with-refs won't resolve here; that's a phase-1 cap.
  const all = new Map(direct);
  for (const { key, init } of candidates) {
    if (init.getKind() !== SyntaxKind.TemplateExpression) continue;
    const lit = resolveTemplateAgainst(init as import('ts-morph').TemplateExpression, direct);
    if (lit !== undefined) all.set(key, lit);
  }
  return all;
}

export function resolveTemplateAgainst(
  tmpl: import('ts-morph').TemplateExpression,
  map: ConstLiteralMap,
): string | undefined {
  let out = tmpl.getHead().getLiteralText();
  for (const span of tmpl.getTemplateSpans()) {
    const expr = span.getExpression();
    if (expr.getKind() !== SyntaxKind.Identifier) return undefined;
    const inner = lookupConstLiteral(expr as import('ts-morph').Identifier, map);
    if (inner === undefined) return undefined;
    out += inner;
    out += span.getLiteral().getLiteralText();
  }
  return out;
}

// Symbol-based lookup. Resolves the identifier to its binding via the TS
// type checker, then checks whether that binding is a literal const we
// collected. Returns `undefined` for any identifier that does NOT bind to
// a single same-file VariableDeclaration in the map — including parameters,
// `let` / `var`, function names, and shadowing declarations. (Phase 2A
// extends this to follow named imports from relative paths to a sibling
// source file.)
//
// Same-file filter on the in-file declarations: TypeScript's symbol for a
// name that shadows a global (e.g. `URL`, `Request`, `Response`) returns
// BOTH the local declaration AND the lib.dom.d.ts ambient. We only care
// about the in-file declaration; the lib ambient never has a literal value.
export function lookupConstLiteral(ident: import('ts-morph').Identifier, map: ConstLiteralMap): string | undefined {
  const sym = ident.getSymbol();
  if (!sym) return undefined;
  const sfPath = ident.getSourceFile().getFilePath();
  const inFile: import('ts-morph').VariableDeclaration[] = [];
  const importSpecs: import('ts-morph').ImportSpecifier[] = [];
  for (const d of sym.getDeclarations()) {
    if (d.getSourceFile().getFilePath() !== sfPath) continue;
    const k = d.getKind();
    if (k === SyntaxKind.VariableDeclaration) {
      inFile.push(d as import('ts-morph').VariableDeclaration);
    } else if (k === SyntaxKind.ImportSpecifier) {
      importSpecs.push(d as import('ts-morph').ImportSpecifier);
    }
  }
  // Same-file binding wins (phase 1 path).
  if (inFile.length === 1 && importSpecs.length === 0) {
    return map.get(declKey(inFile[0]));
  }
  // Phase 2A: cross-file named import. Single ImportSpecifier in this file,
  // no in-file VariableDeclaration. Follow the import to its source.
  if (importSpecs.length === 1 && inFile.length === 0) {
    return resolveImportedConst(importSpecs[0]);
  }
  return undefined;
}

// Phase 2A: follow `import { X } from './c'` to the source file and resolve
// the imported const. Same FP gates as phase 1: the source decl must be a
// single exported `const X = <literal>` (or env-fallback / no-sub template
// or template-with-refs against the source file's own const map).
//
// Out of scope (phase 2A):
//   - Default imports (`import X from './c'`)
//   - Namespace imports (`import * as M from './c'; M.X`)
//   - Non-relative module specifiers (`react`, `@/lib/x`, `@shared/y`)
//   - Re-export chains beyond what ts-morph's symbol resolver already follows
function resolveImportedConst(spec: import('ts-morph').ImportSpecifier): string | undefined {
  const imp = spec.getImportDeclaration();
  const moduleSpec = imp.getModuleSpecifierValue();
  if (!moduleSpec) return undefined;
  if (!moduleSpec.startsWith('./') && !moduleSpec.startsWith('../')) return undefined;

  const srcSf = imp.getModuleSpecifierSourceFile();
  if (!srcSf) return undefined;

  // The imported name as declared in the source module. `import { X as Y }`
  // means we look for `X` in the source, regardless of `Y` alias here.
  const importedName = spec.getNameNode().getText();

  for (const decl of srcSf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getNameNode().getKind() !== SyntaxKind.Identifier) continue;
    if (decl.getName() !== importedName) continue;
    const stmt = decl.getVariableStatement();
    if (!stmt) continue;
    if (stmt.getDeclarationKind() !== VariableDeclarationKind.Const) continue;
    if (!stmt.isExported()) continue;

    const init = decl.getInitializer();
    if (!init) return undefined;

    // Direct literal / no-sub template / env-fallback.
    const direct = literalStringFromInit(init);
    if (direct !== undefined) return direct;

    // Template-with-refs in the SOURCE file's scope. Build that file's own
    // const map and resolve the template against it. resolveTemplateAgainst
    // recurses through lookupConstLiteral, so chained imports
    // (`c.ts → d.ts`) work via the same gate.
    if (init.getKind() === SyntaxKind.TemplateExpression) {
      const srcMap = buildConstLiteralMap(srcSf);
      return resolveTemplateAgainst(init as import('ts-morph').TemplateExpression, srcMap);
    }
    return undefined;
  }
  return undefined;
}
