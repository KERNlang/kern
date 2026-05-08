import { SyntaxKind } from 'ts-morph';
import {
  coarsenTsType,
  extractLiteralObjectFields,
  extractZodSchemaFields,
  type FieldTypeMap,
  type FieldTypeTag,
  isSchemaObjectCall,
  schemaCallValidatesRequestBody,
  unwrapPayloadExpression,
} from '../../helpers/types.js';
import type { ExpressRouteHandlerFn } from './route-handler.js';

// re-export to keep entrypoint module self-contained
export { handlerHasDbWrite } from './pagination.js';

export function extractExpressValidation(
  handlerFn: ExpressRouteHandlerFn,
  routeArgs: readonly import('ts-morph').Node[],
): {
  has: boolean;
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const fields = new Set<string>();
  const types: Record<string, FieldTypeTag> = {};
  let hasValidation = false;
  let resolved = false;

  for (const arg of routeArgs) {
    if (arg === handlerFn) continue;
    if (arg.getStart() > handlerFn.getStart()) continue;
    if (/\b(validate|validator|schema|zod|joi)\b/i.test(arg.getText())) hasValidation = true;
    for (const field of extractExpressValidatorFields(arg)) {
      fields.add(field);
      hasValidation = true;
      resolved = true;
    }
  }

  const handlerText = handlerFn.getText();
  if (/\.(parse|safeParse|validate)\s*\(\s*(req|request)\.body\b/.test(handlerText)) hasValidation = true;

  for (const call of handlerFn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isSchemaObjectCall(call)) continue;
    if (!schemaCallValidatesRequestBody(call)) continue;
    const arg = call.getArguments()[0];
    if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    const callee = call.getExpression().getText();
    const isZod = callee === 'z.object';
    // Only Zod produces reliable wire-shape tags via the chain coarsener.
    // Joi/Yup/Valibot chains coarsen through the generic literal-fields path
    // which (correctly) returns 'unknown' for the schema-builder calls. We
    // gather field NAMES from both, but only TYPES from Zod — recording
    // 'unknown' tags would lock the field set into a less-useful map.
    const extracted = isZod
      ? extractZodSchemaFields(arg as import('ts-morph').ObjectLiteralExpression)
      : extractLiteralObjectFields(arg as import('ts-morph').ObjectLiteralExpression);
    if (!extracted.resolved || !extracted.fields) continue;
    for (const field of extracted.fields) fields.add(field);
    if (isZod && extracted.types) {
      for (const [name, tag] of Object.entries(extracted.types)) {
        if (tag !== 'unknown') types[name] = tag;
      }
    }
    hasValidation = true;
    resolved = true;
  }

  return {
    has: hasValidation,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved,
    types: Object.keys(types).length > 0 ? Object.freeze(types) : undefined,
  };
}

function extractExpressValidatorFields(node: import('ts-morph').Node): string[] {
  const fields: string[] = [];
  const calls =
    node.getKind() === SyntaxKind.CallExpression
      ? [node as import('ts-morph').CallExpression, ...node.getDescendantsOfKind(SyntaxKind.CallExpression)]
      : node.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const callee = call.getExpression().getText();
    if (!/^(body|check|param|query)$/.test(callee) && !/\.(body|check|param|query)$/.test(callee)) continue;
    const first = call.getArguments()[0];
    if (!first || first.getKind() !== SyntaxKind.StringLiteral) continue;
    fields.push((first as import('ts-morph').StringLiteral).getLiteralValue());
  }
  return fields;
}

// Walk an Express handler body and collect the REQUIRED body field names it
// reads. Combines two evidence sources:
//   1. Destructuring:  `const { name, email } = req.body;`
//   2. Property access: `req.body.name`, `req.body['email']`
//
// Default-assignments in destructuring (`{ status = 'active' }`) mark the
// field as optional and are excluded from the required set. A rest element
// (`{ ...rest }`) or a dynamic key (`req.body[var]`) poisons the resolution
// because the handler may need arbitrary fields we can't see.
export function extractHandlerBodyFields(fn: ExpressRouteHandlerFn): {
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const body = fn.getBody();
  if (!body) return { fields: undefined, resolved: false, types: undefined };

  const required = new Set<string>();
  const tagByField = new Map<string, FieldTypeTag>();
  const recordTag = (name: string, tag: FieldTypeTag) => {
    const prev = tagByField.get(name);
    if (prev === undefined) tagByField.set(name, tag);
    else if (prev !== tag) tagByField.set(name, 'unknown');
  };
  let poisoned = false;

  // Accept `req.body`, `(req.body)`, `req.body as Body`, `req.body!`,
  // `req.body satisfies Body`, and any nesting of those.
  const isReqBodyExpr = (node: import('ts-morph').Node | undefined): boolean => {
    if (!node) return false;
    const inner = unwrapPayloadExpression(node);
    return inner.getKind() === SyntaxKind.PropertyAccessExpression && inner.getText() === 'req.body';
  };

  // 1. Destructuring: walk VariableDeclarations whose initializer is `req.body`
  for (const decl of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!isReqBodyExpr(init)) continue;
    const name = decl.getNameNode();
    if (name.getKind() !== SyntaxKind.ObjectBindingPattern) {
      // `const body = req.body` whole-body alias — handler may read anything
      // off `body.X` downstream. Poison the resolution for safety.
      poisoned = true;
      continue;
    }
    for (const el of (name as import('ts-morph').ObjectBindingPattern).getElements()) {
      if (el.getDotDotDotToken()) {
        poisoned = true;
        continue;
      }
      if (el.getInitializer()) {
        // `{ status = 'active' }` — optional, skip.
        continue;
      }
      const elName = el.getNameNode();
      if (elName.getKind() === SyntaxKind.Identifier) {
        const propName = el.getPropertyNameNode()?.getText() ?? elName.getText();
        required.add(propName);
        recordTag(propName, coarsenTsType(elName.getType()));
      } else {
        poisoned = true;
      }
    }
  }

  // 2. Property access: `req.body.name`, `(req.body as Body).name`, etc.
  for (const pa of body.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (!isReqBodyExpr(pa.getExpression())) continue;
    required.add(pa.getName());
    recordTag(pa.getName(), coarsenTsType(pa.getType()));
  }
  for (const el of body.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    if (!isReqBodyExpr(el.getExpression())) continue;
    const arg = el.getArgumentExpression();
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      const lit = (arg as import('ts-morph').StringLiteral).getLiteralValue();
      required.add(lit);
      recordTag(lit, coarsenTsType(el.getType()));
    } else {
      poisoned = true;
    }
  }

  if (poisoned) return { fields: undefined, resolved: false, types: undefined };
  if (required.size === 0) return { fields: undefined, resolved: false, types: undefined };
  const types: Record<string, FieldTypeTag> = {};
  for (const f of required) types[f] = tagByField.get(f) ?? 'unknown';
  return { fields: Array.from(required), resolved: true, types };
}
