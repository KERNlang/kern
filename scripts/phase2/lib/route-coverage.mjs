/**
 * Phase-2 per-route required-tag coverage.
 *
 * A route cannot FLIP from py_legacy to py_ast until its required coverage
 * families are each satisfied by at least one EXPRESSION corpus case (golden
 * spec: "A route cannot flip with a missing required tag"). Slice 0 flips no
 * route, so `computeCoverage` REPORTS missing families; it does not block (the
 * volatile-tag refusal in the gate blocks all flips regardless).
 *
 * Each family maps to one or more corpus tags; a family is satisfied if any
 * non-excluded EXPRESSION case carries any of its tags. Excluded /
 * nondeterministic cases cannot satisfy a family (golden spec).
 */

import { selectCases } from './corpus.mjs';

/**
 * Required coverage families per route. Each family -> the tag(s) that satisfy
 * it. Mirrors the families named in the slice-0 charter for the two seeded
 * routes.
 */
export const REQUIRED_FAMILIES = Object.freeze({
  logical: Object.freeze({
    success: ['result-value', 'success'],
    divergence: ['legacy-bug'],
    'eval-once': ['eval-once'],
    precedence: ['precedence'],
    'nullish-boundary': ['nullish-boundary'],
    'truthy-consumer': ['truthy-consumer'],
    'impure-left': ['member-left', 'index-left'],
    'iterable-position': ['iterable-position'],
  }),
  bitwise: Object.freeze({
    success: ['int32', 'uint32-result', 'sign-bit'],
    'eval-once': ['eval-once'],
    precedence: ['precedence'],
    'parser-boundary': ['parser-boundary'],
    'logical-boundary': ['logical-boundary'],
  }),
});

/**
 * Compute coverage for a route.
 * @param {string} route
 * @returns {{ route:string, requiredFamilies:string[], satisfiedBy:Record<string,string[]>, missingFamilies:string[] }}
 */
export function computeCoverage(route) {
  const families = REQUIRED_FAMILIES[route];
  if (!families) {
    return { route, requiredFamilies: [], satisfiedBy: {}, missingFamilies: [] };
  }
  // Only deterministic EXPRESSION cases for this route count.
  const cases = selectCases({ route, denominator: 'EXPRESSION' }).filter((c) => c.deterministic);
  const requiredFamilies = Object.keys(families);
  /** @type {Record<string,string[]>} */
  const satisfiedBy = {};
  const missingFamilies = [];
  for (const family of requiredFamilies) {
    const tags = families[family];
    const matchIds = cases.filter((c) => c.tags.some((t) => tags.includes(t))).map((c) => c.id);
    satisfiedBy[family] = matchIds;
    if (matchIds.length === 0) missingFamilies.push(family);
  }
  return { route, requiredFamilies, satisfiedBy, missingFamilies };
}

/**
 * Coverage for every route that has required families.
 * @returns {Record<string, ReturnType<typeof computeCoverage>>}
 */
export function computeAllCoverage() {
  /** @type {Record<string, ReturnType<typeof computeCoverage>>} */
  const out = {};
  for (const route of Object.keys(REQUIRED_FAMILIES)) {
    out[route] = computeCoverage(route);
  }
  return out;
}
