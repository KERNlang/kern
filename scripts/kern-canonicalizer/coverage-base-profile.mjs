import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { isAuthenticatedHistoricalCoverageBase } from './historical-coverage-auth.mjs';

export const BASE_EXPRESSION_KINDS = [
  'binary', 'boolean', 'call', 'identifier', 'index', 'integer', 'list', 'member', 'new', 'null', 'text', 'unary',
];
export const BASE_PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.137';
export const BASE_PROMOTIONS = [
  {
    family: 'binary-expression',
    provenanceDigest: '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027',
    provenanceKind: 'selection',
  },
  {
    family: 'conditional',
    provenanceDigest: 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
    provenanceKind: 'selection',
  },
  {
    family: 'call-expression',
    provenanceDigest: '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
    provenanceKind: 'selection',
  },
  {
    family: 'member-expression',
    provenanceDigest: '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
    provenanceKind: 'selection',
  },
  {
    family: 'index-expression',
    provenanceDigest: '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
    provenanceKind: 'prerequisite',
  },
  {
    family: 'counted-iteration',
    provenanceDigest: 'af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b',
    provenanceKind: 'prerequisite',
  },
  {
    family: 'binding',
    provenanceDigest: '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab',
    provenanceKind: 'prerequisite',
  },
  {
    family: 'unary-expression',
    provenanceDigest: 'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5',
    provenanceKind: 'prerequisite',
  },
  {
    family: 'do-statement',
    provenanceDigest: '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72',
    provenanceKind: 'prerequisite',
  },
  {
    family: 'while-iteration',
    provenanceDigest: '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07',
    provenanceKind: 'prerequisite',
  },
  {
    family: 'new-expression',
    provenanceDigest: 'ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e',
    provenanceKind: 'prerequisite',
  },
];
export const BASE_NODE_KINDS = [
  'assign', 'do', 'else', 'fn', 'for', 'handler', 'if', 'let', 'param', 'return', 'while',
];
export const BASE_PROPERTIES = Object.freeze({
  assign: { optional: [], required: ['target', 'value'] },
  do: { optional: [], required: ['value'] },
  else: { optional: [], required: [] },
  fn: { optional: ['export'], required: ['name', 'returns'] },
  for: { optional: [], required: ['from', 'name', 'to'] },
  handler: { optional: [], required: ['lang'] },
  if: { optional: [], required: ['cond'] },
  let: { optional: [], required: ['name', 'value'] },
  param: { optional: [], required: ['name', 'type'] },
  return: { optional: ['value'], required: [] },
  while: { optional: [], required: ['cond'] },
});
const BASE_EXCLUDED_PROPERTY_IDENTITIES = new Set([
  'assign.op',
  'assign.trailingComment',
  'do.trailingComment',
  'for.step',
  'let.expr',
  'let.kind',
  'let.trailingComment',
  'let.type',
]);
export const BASE_PROPERTY_KEYS = BASE_NODE_KINDS.flatMap((kind) =>
  Object.keys(STRUCTURAL_KIR_NODE_CATALOG.get(kind)?.properties ?? {}).map((key) => `${kind}.${key}`)
).filter((identity) => !BASE_EXCLUDED_PROPERTY_IDENTITIES.has(identity)).sort();

function sameText(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isExactHistoricalM460Base(base) {
  return (
    base.id === 'kern.kir-canonicalizer.profile.m4.60' &&
    sameText(base.nodeKinds, BASE_NODE_KINDS) &&
    sameText(base.expressionKinds, BASE_EXPRESSION_KINDS.filter((kind) => kind !== 'new')) &&
    sameText(base.propertyKeys, BASE_PROPERTY_KEYS) &&
    JSON.stringify(base.promotions) === JSON.stringify(BASE_PROMOTIONS.slice(0, -1))
  );
}

export function validateCoverageBase(base) {
  if (
    isAuthenticatedHistoricalCoverageBase(base) &&
    isExactHistoricalM460Base(base)
  ) return base;
  if (
    base.id !== BASE_PROFILE_ID ||
    !sameText(base.nodeKinds, BASE_NODE_KINDS) ||
    !sameText(base.expressionKinds, BASE_EXPRESSION_KINDS) ||
    !sameText(base.propertyKeys, BASE_PROPERTY_KEYS) ||
    JSON.stringify(base.promotions) !== JSON.stringify(BASE_PROMOTIONS)
  ) {
    throw new TypeError('coverage policy rejection: base must exactly match the M4.137 cumulative profile');
  }
  return base;
}
