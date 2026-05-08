import { SyntaxKind } from 'ts-morph';
import { SCHEMA_PRESERVING_OBJECT_MODIFIERS, ZOD_MODIFIERS } from '../signatures.js';
import { isExternalSourcePath } from './ast.js';

// Extract the field names a network call sends on the wire. High-confidence
// sources:
//   - literal objects: `JSON.stringify({ a, b })`, `axios.post(url, { a, b })`
//   - typed payload variables: `JSON.stringify(input)` where `input: CreateUser`
// Everything else returns `{ fields: undefined, resolved: false }` so
// body-shape-drift stays silent on opaque shapes rather than guessing.
//
// `types` is populated alongside `fields` when `resolved === true`: a coarse
// `'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown'`
// tag per field, derived from the value-expression in literal objects or
// from the inferred TS type in typed variables. Lifts cross-stack rules
// from "name overlap" precision to "name + type overlap" — catches the
// `userId: string` (client) vs `userId: number` (server) bug class that
// pure-name matching misses.
export type FieldTypeTag = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
export type FieldTypeMap = Readonly<Record<string, FieldTypeTag>>;

export function extractPayloadFields(node: import('ts-morph').Node): {
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const payload = unwrapPayloadExpression(node);
  if (payload.getKind() === SyntaxKind.CallExpression) {
    const bodyCall = payload as import('ts-morph').CallExpression;
    if (bodyCall.getExpression().getText() !== 'JSON.stringify') {
      return { fields: undefined, resolved: false, types: undefined };
    }
    const stringifyArg = bodyCall.getArguments()[0];
    return stringifyArg ? extractPayloadFields(stringifyArg) : { fields: undefined, resolved: false, types: undefined };
  }
  if (payload.getKind() === SyntaxKind.ObjectLiteralExpression) {
    return extractLiteralObjectFields(payload as import('ts-morph').ObjectLiteralExpression);
  }
  if (payload.getKind() === SyntaxKind.Identifier || payload.getKind() === SyntaxKind.PropertyAccessExpression) {
    return extractObjectFieldsFromType(payload);
  }
  return { fields: undefined, resolved: false, types: undefined };
}

export function unwrapPayloadExpression(node: import('ts-morph').Node): import('ts-morph').Node {
  let current = node;
  while (true) {
    const kind = current.getKind();
    if (kind === SyntaxKind.ParenthesizedExpression) {
      current = (current as import('ts-morph').ParenthesizedExpression).getExpression();
    } else if (kind === SyntaxKind.AsExpression) {
      current = (current as import('ts-morph').AsExpression).getExpression();
    } else if (kind === SyntaxKind.TypeAssertionExpression) {
      current = (current as import('ts-morph').TypeAssertion).getExpression();
    } else if (kind === SyntaxKind.NonNullExpression) {
      current = (current as import('ts-morph').NonNullExpression).getExpression();
    } else if (kind === SyntaxKind.SatisfiesExpression) {
      current = (current as import('ts-morph').SatisfiesExpression).getExpression();
    } else {
      return current;
    }
  }
}

export function extractObjectFieldsFromType(node: import('ts-morph').Node): {
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const type = node.getType();
  if (type.isAny() || type.isUnknown() || type.isUnion()) {
    return { fields: undefined, resolved: false, types: undefined };
  }
  if (type.getStringIndexType() || type.getNumberIndexType()) {
    return { fields: undefined, resolved: false, types: undefined };
  }

  const fields = new Set<string>();
  const types: Record<string, FieldTypeTag> = {};
  for (const prop of type.getProperties()) {
    const declarations = prop.getDeclarations();
    if (declarations.length === 0) return { fields: undefined, resolved: false, types: undefined };
    if (declarations.some((decl) => isExternalSourcePath(decl.getSourceFile().getFilePath()))) {
      return { fields: undefined, resolved: false, types: undefined };
    }
    if (declarations.some((decl) => declarationIsOptional(decl))) continue;
    const name = prop.getName();
    if (!/^[A-Za-z_$][\w$-]*$/.test(name)) return { fields: undefined, resolved: false, types: undefined };
    fields.add(name);
    // Coarse type tag from the property's TS type at the use site.
    const propType = prop.getTypeAtLocation(node);
    types[name] = coarsenTsType(propType);
  }

  if (fields.size === 0) {
    return { fields: [], resolved: true, types: {} };
  }
  return { fields: Array.from(fields).sort(), resolved: true, types };
}

// Map a ts-morph Type to a coarse tag. Conservative: anything we don't
// recognise becomes 'unknown' rather than silently dropped — body-shape-drift
// can then choose to skip 'unknown' tags or treat them as wildcards.
export function coarsenTsType(type: import('ts-morph').Type): FieldTypeTag {
  if (type.isAny() || type.isUnknown() || type.isNever()) return 'unknown';
  if (type.isString() || type.isStringLiteral()) return 'string';
  if (type.isNumber() || type.isNumberLiteral()) return 'number';
  if (type.isBoolean() || type.isBooleanLiteral()) return 'boolean';
  if (type.isNull()) return 'null';
  // Bare `undefined` is NOT 'null' on the wire — `JSON.stringify({x: undefined})`
  // omits the key entirely. We tag it `unknown` so downstream rules don't
  // confuse it with an explicit-null field. Codex review caught this.
  if (type.isUndefined()) return 'unknown';
  if (type.isArray() || type.isTuple()) return 'array';
  if (type.isUnion()) {
    // Drop nullability branches (`T | null | undefined → T`) before
    // coarsening — `null`/`undefined` are absorbed since the rule's question
    // is "what is the shape of the present value?" not "is the field
    // optional?". Then if the remaining branches all coarsen to one tag,
    // return it; else `unknown`.
    const branches = type.getUnionTypes().filter((t) => !t.isNull() && !t.isUndefined());
    if (branches.length === 0) return 'null';
    if (branches.length === 1) return coarsenTsType(branches[0]);
    const tags = new Set(branches.map(coarsenTsType));
    if (tags.size === 1) return [...tags][0];
    return 'unknown';
  }
  // Branded primitives (`string & { __brand: 'UserId' }`) are very common
  // for ID/count types. We walk the intersection branches: if any branch
  // coarsens to a primitive, take that tag — the brand is structural noise
  // we don't need on the wire. Codex review caught the original
  // implementation collapsing brands to 'unknown'.
  if (type.isIntersection()) {
    const branchTags = type.getIntersectionTypes().map(coarsenTsType);
    for (const tag of branchTags) {
      if (tag === 'string' || tag === 'number' || tag === 'boolean') return tag;
    }
    if (branchTags.every((t) => t === 'object')) return 'object';
    return 'unknown';
  }
  if (type.isObject()) return 'object';
  return 'unknown';
}

export function declarationIsOptional(decl: import('ts-morph').Node): boolean {
  const maybeOptional = decl as import('ts-morph').Node & { hasQuestionToken?: () => boolean };
  return maybeOptional.hasQuestionToken?.() === true;
}

// Walk an object literal and return its identifier-keyed property names.
// Spread (`...x`) or computed keys (`[x]: ...`) poison the resolution —
// we mark unresolved rather than return a partial field list that would
// produce false positives downstream.
export function extractLiteralObjectFields(obj: import('ts-morph').ObjectLiteralExpression): {
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const fields: string[] = [];
  const types: Record<string, FieldTypeTag> = {};
  for (const prop of obj.getProperties()) {
    const kind = prop.getKind();
    if (kind === SyntaxKind.SpreadAssignment) return { fields: undefined, resolved: false, types: undefined };
    if (kind === SyntaxKind.PropertyAssignment) {
      const pa = prop as import('ts-morph').PropertyAssignment;
      const name = pa.getNameNode();
      if (name.getKind() === SyntaxKind.ComputedPropertyName) {
        return { fields: undefined, resolved: false, types: undefined };
      }
      if (name.getKind() === SyntaxKind.Identifier || name.getKind() === SyntaxKind.StringLiteral) {
        const fieldName = name.getText().replace(/['"]/g, '');
        fields.push(fieldName);
        // Type tag from the value expression. Tries syntactic recognition
        // first (cheap, exact for literals), then falls back to TS type
        // inference for variables / property accesses.
        const init = pa.getInitializer();
        types[fieldName] = init ? coarsenValueExpression(init) : 'unknown';
      } else {
        return { fields: undefined, resolved: false, types: undefined };
      }
    } else if (kind === SyntaxKind.ShorthandPropertyAssignment) {
      const sh = prop as import('ts-morph').ShorthandPropertyAssignment;
      const fieldName = sh.getName();
      fields.push(fieldName);
      // Shorthand: `{ foo }` is sugar for `{ foo: foo }`. Use the binding's
      // inferred TS type at this location.
      const ident = sh.getNameNode();
      types[fieldName] = coarsenTsType(ident.getType());
    } else {
      // Method definitions, getters, setters — unusual in a fetch body,
      // treat as unresolved.
      return { fields: undefined, resolved: false, types: undefined };
    }
  }
  return { fields, resolved: true, types };
}

// Coarsen the value-expression of a literal object property. Syntactic
// fast paths cover the common literal cases without invoking the TS type
// checker; everything else falls through to type-based coarsening.
export function coarsenValueExpression(expr: import('ts-morph').Node): FieldTypeTag {
  const k = expr.getKind();
  if (
    k === SyntaxKind.StringLiteral ||
    k === SyntaxKind.NoSubstitutionTemplateLiteral ||
    k === SyntaxKind.TemplateExpression
  ) {
    return 'string';
  }
  if (k === SyntaxKind.NumericLiteral) return 'number';
  if (k === SyntaxKind.TrueKeyword || k === SyntaxKind.FalseKeyword) return 'boolean';
  if (k === SyntaxKind.NullKeyword) return 'null';
  if (k === SyntaxKind.ObjectLiteralExpression) return 'object';
  if (k === SyntaxKind.ArrayLiteralExpression) return 'array';
  // PrefixUnary: the unary operator dictates the result type, NOT the
  // operand. `+x`, `-x`, `~x` always yield number even if x is a string
  // (`+'1'` is type `number`); `!x` always yields boolean. Recursing into
  // the operand would lie. Codex review caught this.
  if (k === SyntaxKind.PrefixUnaryExpression) {
    const op = (expr as import('ts-morph').PrefixUnaryExpression).getOperatorToken();
    if (op === SyntaxKind.PlusToken || op === SyntaxKind.MinusToken || op === SyntaxKind.TildeToken) {
      return 'number';
    }
    if (op === SyntaxKind.ExclamationToken) {
      return 'boolean';
    }
    // Unknown prefix operator — fall through to TS type checker.
    return coarsenTsType(expr.getType());
  }
  // Parenthesized / as-cast / non-null: unwrap and recurse.
  if (k === SyntaxKind.ParenthesizedExpression) {
    return coarsenValueExpression((expr as import('ts-morph').ParenthesizedExpression).getExpression());
  }
  if (k === SyntaxKind.AsExpression) {
    return coarsenValueExpression((expr as import('ts-morph').AsExpression).getExpression());
  }
  if (k === SyntaxKind.NonNullExpression) {
    return coarsenValueExpression((expr as import('ts-morph').NonNullExpression).getExpression());
  }
  // Fallback: ask the TS type checker. Catches `Identifier`,
  // `PropertyAccessExpression`, `ConditionalExpression` (`x ?? null`),
  // `BinaryExpression`, etc.
  return coarsenTsType(expr.getType());
}

// True when the given expression is `z.coerce` (or any `*.coerce`) — used
// to reject `z.coerce.<primitive>()` calls in the Zod coarsener.
export function isZodCoerceReceiver(expr: import('ts-morph').Node): boolean {
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  return (expr as import('ts-morph').PropertyAccessExpression).getName() === 'coerce';
}

// Coarsen a Zod schema call expression (`z.string().optional()`) to the same
// FieldTypeTag union used elsewhere. Walks chained modifier calls inward to
// the base type-producing method, tags it, and returns. Unknown chains
// collapse to `'unknown'` rather than guessing.
export function coarsenZodCall(expr: import('ts-morph').Node): FieldTypeTag {
  let cur: import('ts-morph').Node = expr;
  // Bound the walk so a runaway chain can't loop. 16 is generous — even
  // pathological Zod chains (`.min().max().refine().transform()...`) stay well
  // below this in practice.
  for (let depth = 0; depth < 16; depth++) {
    if (cur.getKind() !== SyntaxKind.CallExpression) return 'unknown';
    const call = cur as import('ts-morph').CallExpression;
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) {
      // Bare call like `MySchema()` or `customSchema()` — we can't classify it.
      return 'unknown';
    }
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = pa.getName();
    if (ZOD_MODIFIERS.has(methodName)) {
      cur = pa.getExpression();
      continue;
    }
    // Reject `z.coerce.X()` regardless of which X: coerce explicitly
    // accepts cross-primitive inputs (string ↔ number ↔ boolean ↔ bigint
    // ↔ date) and converts them. The wire shape is therefore unknowable —
    // tagging `z.coerce.number()` as 'number' fired FPs on clients
    // legitimately sending strings ("42" → 42). Codex caught this.
    if (isZodCoerceReceiver(pa.getExpression())) return 'unknown';
    switch (methodName) {
      case 'string':
      case 'enum':
      case 'nativeEnum':
        return 'string';
      case 'date':
        // Zod's `z.date()` only accepts JS Date objects, NOT JSON strings.
        // On the wire, dates serialise as strings — so a client sending
        // `{date: '2024-01-01'}` against `z.date()` would fail at runtime
        // even though both ends "agree on string". Tagging 'unknown' keeps
        // /type silent here; users typically reach for `z.coerce.date()`
        // (which the modifier path handles by drilling into z.coerce.date).
        return 'unknown';
      case 'number':
      case 'bigint':
      case 'int':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array':
      case 'set':
      case 'tuple':
        return 'array';
      case 'object':
      case 'record':
      case 'map':
      case 'discriminatedUnion':
        return 'object';
      case 'literal': {
        // `z.literal('admin')` — coarsen the literal arg to its primitive tag.
        const arg = call.getArguments()[0];
        if (!arg) return 'unknown';
        return coarsenValueExpression(arg);
      }
      case 'union': {
        // `z.union([z.string(), z.number()])` — only stable if every branch
        // coarsens to the same non-null tag, else 'unknown'. Mirrors
        // `coarsenTsType`'s union handling: drop `z.null()` branches
        // first, then check tag agreement on what remains. This keeps
        // `z.union([z.string(), z.null()])` reading as 'string' so a
        // client sending `number` against it still flags. Gemini-flagged
        // precision miss in v1.
        //
        // ANY 'unknown' branch poisons the result — we'd be guessing
        // optimistically otherwise. Drop only literal nulls.
        const arg = call.getArguments()[0];
        if (!arg || arg.getKind() !== SyntaxKind.ArrayLiteralExpression) return 'unknown';
        const elements = (arg as import('ts-morph').ArrayLiteralExpression).getElements();
        if (elements.length === 0) return 'unknown';
        const allTags = elements.map(coarsenZodCall);
        if (allTags.includes('unknown')) return 'unknown';
        const branches = allTags.filter((t) => t !== 'null');
        if (branches.length === 0) return 'null';
        const tags = new Set(branches);
        if (tags.size === 1) return [...tags][0];
        return 'unknown';
      }
      default:
        return 'unknown';
    }
  }
  return 'unknown';
}

// Walk a Zod schema literal (the object passed to `z.object({...})`) and
// produce {fieldName -> FieldTypeTag}. Mirrors `extractLiteralObjectFields`
// but uses `coarsenZodCall` for value classification — the values here are
// Zod chains (`z.string().optional()`), not plain TS literals.
export function extractZodSchemaFields(obj: import('ts-morph').ObjectLiteralExpression): {
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const fields: string[] = [];
  const types: Record<string, FieldTypeTag> = {};
  for (const prop of obj.getProperties()) {
    const kind = prop.getKind();
    if (kind === SyntaxKind.SpreadAssignment) {
      return { fields: undefined, resolved: false, types: undefined };
    }
    if (kind !== SyntaxKind.PropertyAssignment) {
      // Shorthand / method assignments aren't valid Zod shape entries; bail
      // rather than emit half-resolved types.
      return { fields: undefined, resolved: false, types: undefined };
    }
    const pa = prop as import('ts-morph').PropertyAssignment;
    const nameNode = pa.getNameNode();
    const nameKind = nameNode.getKind();
    if (nameKind === SyntaxKind.ComputedPropertyName) {
      return { fields: undefined, resolved: false, types: undefined };
    }
    if (nameKind !== SyntaxKind.Identifier && nameKind !== SyntaxKind.StringLiteral) {
      return { fields: undefined, resolved: false, types: undefined };
    }
    const fieldName = nameNode.getText().replace(/['"]/g, '');
    fields.push(fieldName);
    const init = pa.getInitializer();
    types[fieldName] = init ? coarsenZodCall(init) : 'unknown';
  }
  return {
    fields,
    resolved: true,
    types,
  };
}

export function isSchemaObjectCall(call: import('ts-morph').CallExpression): boolean {
  const callee = call.getExpression().getText();
  return callee === 'z.object' || callee === 'Joi.object' || callee.endsWith('.object');
}

// Decide whether THIS specific `z.object({...})` call is the schema being
// `.parse(req.body)`'d, by walking strictly along its method chain rather
// than text-searching ancestor blocks. Codex caught the old text-based
// version: any unrelated `z.object(...)` whose enclosing block also
// contained a separate `.parse(req.body)` (e.g. response validators) was
// mis-tagged as the request schema, producing false /type findings.
//
// True ONLY when:
//   1. Each chained method between this z.object and the terminating call
//      is a known shape-preserving modifier (so the recorded field tags
//      still describe what the schema validates), AND
//   2. The terminating call is `.parse|.safeParse|.validate(req.body)`.
export function schemaCallValidatesRequestBody(call: import('ts-morph').CallExpression): boolean {
  let cur: import('ts-morph').Node = call;
  for (let depth = 0; depth < 8; depth++) {
    const parent = cur.getParent();
    if (!parent) return false;
    if (parent.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const grand = parent.getParent();
    if (!grand || grand.getKind() !== SyntaxKind.CallExpression) return false;
    const pa = parent as import('ts-morph').PropertyAccessExpression;
    const callExpr = grand as import('ts-morph').CallExpression;
    // pa must be the CALLEE (cur.method(...)), not an argument (foo(cur.method)).
    if (callExpr.getExpression() !== pa) return false;
    const methodName = pa.getName();
    if (methodName === 'parse' || methodName === 'safeParse' || methodName === 'validate') {
      const arg = callExpr.getArguments()[0];
      if (!arg) return false;
      return /^(req|request)\.body\b/.test(arg.getText());
    }
    if (!SCHEMA_PRESERVING_OBJECT_MODIFIERS.has(methodName)) return false;
    cur = grand;
  }
  return false;
}
