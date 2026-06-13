/**
 * Phase-2 Gate-INT ratchet — legacy-vs-AST convergence verdict derivation.
 *
 * Verdict derivation order (phase2-harness-design.md "Verdict derivation order"
 * + phase2-runner-prelude.md "Verdict comparison hook") — SEMANTIC checks BEFORE
 * any byte comparison, because byte-equal-but-both-wrong must NOT count as
 * progress:
 *
 *   1. Capture tsCanon, pyLegacy.runtimeCanon, pyAst.runtimeCanon, expectedCanon.
 *   2. Compare each successful route to TS, and (if present) to expected.
 *   3. SEMANTIC_BOTH_WRONG: both python routes ran, AGREE with each other, but
 *      DISAGREE with TS/expected — derived before any byte comparison.
 *   4. Only-AST-wrong  -> AST_BLOCKED (capture fail) / RUNTIME_DIVERGE (ran wrong).
 *   5. Only-legacy-wrong -> LEGACY_BLOCKED (requires triage 'legacy-bug').
 *   6. Both semantically OK -> BYTE_EQUAL / RUNTIME_EQUAL_BYTE_DIFF.
 *   7. Capture/blocked states: AST_BLOCKED / LEGACY_BLOCKED / BOTH_BLOCKED_SAME /
 *      BOTH_BLOCKED_DIFF / CAPTURE_ERROR.
 *
 * Output: the reviewable five-column TSV
 *   case_id<TAB>route<TAB>py_legacy<TAB>py_ast<TAB>verdict
 * plus the machine JSON mirror (`ratchet.json`) with per-case runtimeCanon /
 * error / tags and summary counts. ratchetCount = BYTE_EQUAL +
 * RUNTIME_EQUAL_BYTE_DIFF; SEMANTIC_BOTH_WRONG is excluded from ratchetCount and
 * is CI-failing.
 */

/**
 * Verdict ordering, best -> worst. A current verdict may not be worse than the
 * saved baseline's verdict for the same case (monotonic ratchet).
 */
export const VERDICT_ORDER = [
  'BYTE_EQUAL',
  'RUNTIME_EQUAL_BYTE_DIFF',
  'BOTH_BLOCKED_SAME',
  'LEGACY_BLOCKED',
  'AST_BLOCKED',
  'BOTH_BLOCKED_DIFF',
  'RUNTIME_DIVERGE',
  'SEMANTIC_BOTH_WRONG',
  'CAPTURE_ERROR',
];

/** @param {string} v */
function rank(v) {
  const i = VERDICT_ORDER.indexOf(v);
  return i === -1 ? VERDICT_ORDER.length : i;
}

/**
 * Derive a single case verdict from captures + runtimes.
 *
 * @param {object} input
 * @param {string} input.caseId
 * @param {string} input.route
 * @param {{status:'ok',code:string}|{status:'error',code:string,category:string}} input.legacyCapture
 * @param {{status:'ok',code:string}|{status:'error',code:string,category:string}} input.astCapture
 * @param {{status:'ok',runtimeCanon:string}|{status:'error',code:string,category:string}} input.legacyRun
 * @param {{status:'ok',runtimeCanon:string}|{status:'error',code:string,category:string}} input.astRun
 * @param {{status:'ok',runtimeCanon:string}|{status:'error',code:string,category:string}|null} input.tsRun
 * @param {string|null} input.expectedCanon
 * @returns {{ verdict:string, triage:string|null }}
 */
export function deriveVerdict(input) {
  const { legacyCapture, astCapture, legacyRun, astRun, tsRun, expectedCanon } = input;

  const legacyCaptured = legacyCapture.status === 'ok';
  const astCaptured = astCapture.status === 'ok';
  const legacyRan = legacyRun.status === 'ok';
  const astRan = astRun.status === 'ok';

  const legacyCanon = legacyRan ? legacyRun.runtimeCanon : null;
  const astCanon = astRan ? astRun.runtimeCanon : null;
  const tsCanon = tsRun && tsRun.status === 'ok' ? tsRun.runtimeCanon : null;

  // The semantic reference: prefer TS; expected must also agree when present.
  // A route is "semantically correct" iff it matches TS (when TS ran) AND
  // matches expected (when expected exists). With neither available we cannot
  // judge semantics, so we fall back to byte/capture verdicts.
  const haveReference = tsCanon !== null || expectedCanon !== null;

  /** @param {string|null} canon */
  const semOk = (canon) => {
    if (canon === null) return false;
    if (tsCanon !== null && canon !== tsCanon) return false;
    if (expectedCanon !== null && canon !== expectedCanon) return false;
    return true;
  };

  // Step 3: SEMANTIC_BOTH_WRONG — both ran, agree with each other, disagree with reference.
  if (haveReference && legacyRan && astRan && legacyCanon === astCanon && !semOk(legacyCanon)) {
    return { verdict: 'SEMANTIC_BOTH_WRONG', triage: 'both-bug' };
  }

  if (haveReference) {
    const legacyGood = legacyRan && semOk(legacyCanon);
    const astGood = astRan && semOk(astCanon);

    // Step 5: only legacy wrong (AST good) -> LEGACY_BLOCKED, triage legacy-bug.
    if (astGood && !legacyGood) {
      return { verdict: 'LEGACY_BLOCKED', triage: 'legacy-bug' };
    }
    // Step 4: only AST wrong (legacy good).
    if (legacyGood && !astGood) {
      // AST failed to capture/run -> AST_BLOCKED; AST ran but wrong -> RUNTIME_DIVERGE.
      if (!astCaptured || !astRan) return { verdict: 'AST_BLOCKED', triage: 'ast-bug' };
      return { verdict: 'RUNTIME_DIVERGE', triage: 'ast-bug' };
    }
    // Both wrong but DISAGREE (not caught by step 3) — neither route is correct.
    if (!legacyGood && !astGood) {
      // If both ran AND produced (different) values, that is RUNTIME_DIVERGE.
      if (legacyRan && astRan) return { verdict: 'RUNTIME_DIVERGE', triage: 'both-bug' };
      // Otherwise at least one route is blocked (failed capture or failed run);
      // fall through to the blocked classification below.
    }
    // Both good -> proceed to byte comparison (step 6).
    if (legacyGood && astGood) {
      return byteVerdict(legacyCapture, astCapture);
    }
  } else {
    // No reference at all (e.g. parse-boundary rows with no executable expected).
    // Use capture/byte verdicts only.
    if (legacyCaptured && astCaptured && legacyRan && astRan && legacyCanon === astCanon) {
      return byteVerdict(legacyCapture, astCapture);
    }
  }

  // Step 7: blocked classification. A route is BLOCKED if it failed to capture
  // OR failed to run. The blocking error code is the run error when it ran-blocked,
  // else the capture error — so two parse-boundary rows that both NameError at
  // runtime classify as BOTH_BLOCKED_SAME (not CAPTURE_ERROR).
  return blockedVerdict(
    effectiveBlock(legacyCapture, legacyRun),
    effectiveBlock(astCapture, astRun),
  );
}

/**
 * Reduce a route's capture + run into a single effective state.
 * @param {{status:'ok',code:string}|{status:'error',code:string,category:string}} capture
 * @param {{status:'ok',runtimeCanon:string}|{status:'error',code:string,category:string}} run
 * @returns {{ok:boolean, code:string|null, category:string|null}}
 */
function effectiveBlock(capture, run) {
  if (capture.status === 'error') {
    return { ok: false, code: capture.code, category: capture.category };
  }
  if (run.status === 'error') {
    return { ok: false, code: run.code, category: run.category };
  }
  return { ok: true, code: null, category: null };
}

/**
 * Both routes semantically OK: byte-equal vs runtime-equal-byte-diff.
 * @param {{status:'ok',code:string}|{status:string}} legacyCapture
 * @param {{status:'ok',code:string}|{status:string}} astCapture
 */
function byteVerdict(legacyCapture, astCapture) {
  if (legacyCapture.status === 'ok' && astCapture.status === 'ok') {
    return legacyCapture.code === astCapture.code
      ? { verdict: 'BYTE_EQUAL', triage: null }
      : { verdict: 'RUNTIME_EQUAL_BYTE_DIFF', triage: null };
  }
  // One route ran correctly without an emitted byte artifact — should not happen
  // for executable cases, but never claim BYTE_EQUAL without both byte strings.
  return { verdict: 'RUNTIME_EQUAL_BYTE_DIFF', triage: null };
}

/**
 * Blocked classification from each route's effective (capture+run) state.
 * @param {{ok:boolean, code:string|null, category:string|null}} legacy
 * @param {{ok:boolean, code:string|null, category:string|null}} ast
 */
function blockedVerdict(legacy, ast) {
  if (legacy.ok && !ast.ok) return { verdict: 'AST_BLOCKED', triage: 'ast-bug' };
  if (!legacy.ok && ast.ok) return { verdict: 'LEGACY_BLOCKED', triage: 'legacy-bug' };
  if (!legacy.ok && !ast.ok) {
    // Same NORMALIZED error category => BOTH_BLOCKED_SAME; differing => DIFF.
    // Category (not raw code) is the contract axis per the anti-gaming rule.
    const sameCategory = legacy.category === ast.category;
    return sameCategory
      ? { verdict: 'BOTH_BLOCKED_SAME', triage: null }
      : { verdict: 'BOTH_BLOCKED_DIFF', triage: null };
  }
  // Both effectively OK but we still landed here -> semantics indeterminate
  // (e.g. no reference and runtimes disagree). Never fake progress.
  return { verdict: 'CAPTURE_ERROR', triage: null };
}

/**
 * routeStatus string for a TSV column: `ok:<sha>` or `error:<code>:<category>`.
 * @param {{status:'ok',code:string}|{status:'error',code:string,category:string}} capture
 * @param {(s:string)=>string} sha
 */
export function routeColumn(capture, sha) {
  if (capture.status === 'ok') return `ok:${sha(capture.code)}`;
  return `error:${capture.code}:${capture.category}`;
}

/**
 * Render the five-column TSV from per-case records.
 * @param {Array<{caseId:string, route:string, pyLegacyColumn:string, pyAstColumn:string, verdict:string}>} records
 * @returns {string}
 */
export function renderTsv(records) {
  const header = ['case_id', 'route', 'py_legacy', 'py_ast', 'verdict'].join('\t');
  const lines = records.map((r) =>
    [r.caseId, r.route, r.pyLegacyColumn, r.pyAstColumn, r.verdict].join('\t'),
  );
  return `${[header, ...lines].join('\n')}\n`;
}

/**
 * Summary counts from records. ratchetCount excludes SEMANTIC_BOTH_WRONG.
 * @param {Array<{verdict:string, fallbackUsed?:boolean}>} records
 */
export function summarize(records) {
  let byteEqualCount = 0;
  let runtimeEqualByteDiffCount = 0;
  let semanticBothWrongCount = 0;
  let fallbackCount = 0;
  for (const r of records) {
    if (r.verdict === 'BYTE_EQUAL') byteEqualCount += 1;
    else if (r.verdict === 'RUNTIME_EQUAL_BYTE_DIFF') runtimeEqualByteDiffCount += 1;
    else if (r.verdict === 'SEMANTIC_BOTH_WRONG') semanticBothWrongCount += 1;
    if (r.fallbackUsed) fallbackCount += 1;
  }
  return {
    selectedCaseCount: records.length,
    ratchetCount: byteEqualCount + runtimeEqualByteDiffCount,
    byteEqualCount,
    runtimeEqualByteDiffCount,
    semanticBothWrongCount,
    fallbackCount,
  };
}

/**
 * Monotonic ratchet regression check vs a saved baseline.
 * Fails (returns violations) if:
 *   - any individual case verdict is WORSE than the baseline's,
 *   - aggregate ratchetCount drops,
 *   - aggregate byteEqualCount drops,
 *   - aggregate fallbackCount rises.
 * New cases (absent from baseline) are allowed (no prior verdict to regress).
 * @param {{records:Array<{caseId:string,verdict:string}>, summary:object}} current
 * @param {{records:Array<{caseId:string,verdict:string}>, summary:object}} baseline
 * @returns {string[]} violations (empty = pass)
 */
export function checkRegression(current, baseline) {
  const violations = [];
  const baseByCase = new Map(baseline.records.map((r) => [r.caseId, r.verdict]));
  for (const r of current.records) {
    const prev = baseByCase.get(r.caseId);
    if (prev === undefined) continue;
    if (rank(r.verdict) > rank(prev)) {
      violations.push(
        `INT_RATCHET_REGRESSION: ${r.caseId} verdict regressed ${prev} -> ${r.verdict}`,
      );
    }
  }
  const cs = current.summary;
  const bs = baseline.summary;
  if (typeof bs.ratchetCount === 'number' && cs.ratchetCount < bs.ratchetCount) {
    violations.push(`INT_RATCHET_REGRESSION: ratchetCount dropped ${bs.ratchetCount} -> ${cs.ratchetCount}`);
  }
  if (typeof bs.byteEqualCount === 'number' && cs.byteEqualCount < bs.byteEqualCount) {
    violations.push(`INT_RATCHET_REGRESSION: byteEqualCount dropped ${bs.byteEqualCount} -> ${cs.byteEqualCount}`);
  }
  if (typeof bs.fallbackCount === 'number' && cs.fallbackCount > bs.fallbackCount) {
    violations.push(`INT_FALLBACK_COUNT_REGRESSION: fallbackCount rose ${bs.fallbackCount} -> ${cs.fallbackCount}`);
  }
  return violations;
}
