import { projectExpressionText } from '../../packages/core/dist/kir-structural/expression.js';
import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { StructuralKirError } from '../../packages/core/dist/kir-structural/types.js';
import { parseExpression } from '../../packages/core/dist/parser-expression.js';
import { canonicalProfileRowsForFunction } from './coverage-profile.mjs';

function containsNewExpression(value) {
  if (value === null || typeof value !== 'object') return false;
  if (value.kind === 'new') return true;
  if (Array.isArray(value)) return value.some(containsNewExpression);
  return Object.values(value).some(containsNewExpression);
}

function parseCoverageExpression(source, path) {
  try {
    return parseExpression(source);
  } catch {
    throw new StructuralKirError(
      'invalid-expression',
      path,
      'expression cannot be parsed by the portable parser',
    );
  }
}

export function projectCoverageExpression(source, path, preM4135) {
  if (preM4135 && containsNewExpression(parseCoverageExpression(source, path))) {
    throw new StructuralKirError(
      'unknown-expression-kind',
      path,
      'new is outside the pre-M4.135 expression catalog',
    );
  }
  return projectExpressionText(source, path);
}

export function canonicalProfileRowsForCoverage(root, limits, preM4135, excludedProperties) {
  if (preM4135 && excludedProperties.some((value) => value.endsWith(':unknown-expression-kind'))) {
    throw new StructuralKirError(
      'unknown-expression-kind',
      '$',
      'new is outside the pre-M4.135 expression catalog',
    );
  }
  return canonicalProfileRowsForFunction(root, limits);
}

function sourceText(value) {
  if (typeof value === 'string') return value;
  if (value?.__expr === true && typeof value.code === 'string') return value.code;
  return null;
}

function rootContainsNewExpression(root) {
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(root.type);
  for (const [key, value] of Object.entries(root.props ?? {})) {
    if (contract?.properties[key]?.disposition !== 'lowered-expression') continue;
    const source = sourceText(value);
    if (source !== null && containsNewExpression(parseCoverageExpression(source, '$'))) return true;
  }
  return (root.children ?? []).some(rootContainsNewExpression);
}

export function canonicalProfileRowsForPreM4135(root, limits) {
  if (rootContainsNewExpression(root)) {
    throw new StructuralKirError(
      'unknown-expression-kind',
      '$',
      'new is outside the pre-M4.135 expression catalog',
    );
  }
  return canonicalProfileRowsForFunction(root, limits);
}
