import { parseExpression } from './parser-expression.js';
import { isParenthesized, isValueIR } from './value-ir.js';

export type EachCollectionReference =
  | { readonly form: 'binding'; readonly name: string }
  | { readonly form: 'record-array-field'; readonly receiver: string; readonly property: string };

export type EachCollectionReferenceClassification =
  | { readonly status: 'reference'; readonly reference: EachCollectionReference }
  | { readonly status: 'missing-binding'; readonly name: string }
  | { readonly status: 'unsupported' };

export function classifyEachCollectionReference(source: string): EachCollectionReferenceClassification {
  const expression = parseExpression(source);
  if (expression.kind === 'ident') {
    if (!isParenthesized(expression) && source === expression.name) {
      return { status: 'reference', reference: { form: 'binding', name: expression.name } };
    }
    return { status: 'missing-binding', name: expression.name };
  }
  if (
    expression.kind === 'member' &&
    !expression.optional &&
    isValueIR(expression.object) &&
    expression.object.kind === 'ident' &&
    !isParenthesized(expression.object)
  ) {
    return {
      status: 'reference',
      reference: {
        form: 'record-array-field',
        receiver: expression.object.name,
        property: expression.property,
      },
    };
  }
  return { status: 'unsupported' };
}

export function canonicalEachCollectionReferenceSource(reference: EachCollectionReference): string {
  return reference.form === 'binding' ? reference.name : `${reference.receiver}.${reference.property}`;
}
