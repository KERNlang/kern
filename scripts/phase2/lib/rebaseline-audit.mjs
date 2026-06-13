/**
 * Phase-2 Gate-EXT rebaseline adjudication (runtime-equality gate).
 *
 * Gate-EXT may only be rebaselined after a runtime-equality proof — a normalized
 * byte change alone is NEVER sufficient (golden spec "Rebaseline rule"). This
 * module is the adjudicator. Given the OLD snapshot artifact and the CURRENT
 * candidate artifact for a case, it:
 *
 *   1. Requires an old baseline to exist (a missing old baseline is a NEW
 *      addition needing review, never a "rebaseline") -> EXT_REBASELINE_DENIED.
 *   2. Recreates and EXECUTES both the OLD and CURRENT artifacts (caller passes
 *      an `execute(code)` thunk that runs the artifact and returns its typed
 *      runtimeCanon, or an error).
 *   3. Requires `ts == old_py == new_py == expected` when expected exists, else
 *      `ts == old_py == new_py`.
 *   4. Refuses if equality relies on lossy JSON canonicalization — i.e. any
 *      runtimeCanon is a `sha256:` placeholder rather than the literal envelope,
 *      OR the value collapses a sentinel/NaN/-0 distinction (we require the
 *      typed envelope string, which preserves those by construction).
 *   5. Returns a structured adjudication record for `manifest.json`.
 *
 * For slice 0 nothing is rebaselined in anger; this is exercised by a unit test
 * (`ratchet.test.ts` covers the verdict math; the gate-meta test drives the
 * deny paths). The function is pure given its `execute` thunk, so the test can
 * inject deterministic old/new/ts/expected canons.
 */

/**
 * @typedef {{status:'ok',runtimeCanon:string}|{status:'error',code:string,category:string}} RunResult
 */

/**
 * Adjudicate a single-case Gate-EXT rebaseline.
 *
 * @param {object} input
 * @param {string} input.caseId
 * @param {string} input.route
 * @param {string|null} input.oldArtifact   OLD snapshot bytes (null = missing)
 * @param {string} input.newArtifact        CURRENT candidate bytes
 * @param {(code:string)=>RunResult} input.executeArtifact run an artifact -> typed canon
 * @param {RunResult} input.tsRun           TS reference run
 * @param {string|null} input.expectedCanon
 * @param {object} input.adjudication       { reasonCode, reasonDetail, reviewer }
 * @returns {{ ok:true, record:object } | { ok:false, code:string, detail:string }}
 */
export function adjudicateRebaseline(input) {
  const { caseId, route, oldArtifact, newArtifact, executeArtifact, tsRun, expectedCanon, adjudication } = input;

  if (oldArtifact === null || oldArtifact === undefined) {
    return {
      ok: false,
      code: 'EXT_REBASELINE_DENIED',
      detail: `${caseId}: no old baseline — a missing baseline is a NEW addition needing review, not a rebaseline`,
    };
  }
  if (!adjudication || typeof adjudication.reasonCode !== 'string' || !adjudication.reasonCode) {
    return { ok: false, code: 'EXT_REBASELINE_DENIED', detail: `${caseId}: structured reasonCode required` };
  }
  if (typeof adjudication.reviewer !== 'string' || !adjudication.reviewer) {
    return { ok: false, code: 'EXT_REBASELINE_DENIED', detail: `${caseId}: reviewer id required` };
  }

  const oldRun = executeArtifact(oldArtifact);
  const newRun = executeArtifact(newArtifact);

  if (oldRun.status !== 'ok' || newRun.status !== 'ok' || tsRun.status !== 'ok') {
    return {
      ok: false,
      code: 'EXT_RUNTIME_ERROR',
      detail: `${caseId}: an artifact failed to execute (old=${oldRun.status} new=${newRun.status} ts=${tsRun.status})`,
    };
  }

  // Refuse lossy canon: we require the literal typed envelope, not a sha digest.
  for (const [label, run] of [['old', oldRun], ['new', newRun], ['ts', tsRun]]) {
    if (run.runtimeCanon.startsWith('sha256:')) {
      return {
        ok: false,
        code: 'EXT_REBASELINE_DENIED',
        detail: `${caseId}: ${label} runtimeCanon is a sha digest — equality must rest on the lossless typed envelope`,
      };
    }
  }

  const eq = oldRun.runtimeCanon === newRun.runtimeCanon && newRun.runtimeCanon === tsRun.runtimeCanon;
  if (!eq) {
    return {
      ok: false,
      code: 'EXT_RUNTIME_DRIFT',
      detail: `${caseId}: ts/old/new runtime canons disagree`,
    };
  }
  if (expectedCanon !== null && expectedCanon !== undefined && newRun.runtimeCanon !== expectedCanon) {
    return {
      ok: false,
      code: 'EXT_RUNTIME_DRIFT',
      detail: `${caseId}: runtime canon disagrees with expected`,
    };
  }

  const record = {
    kind: 'runtime-equal',
    reasonCode: adjudication.reasonCode,
    reasonDetail: adjudication.reasonDetail ?? route,
    reviewer: adjudication.reviewer,
    caseId,
    route,
    oldRuntimeCanon: oldRun.runtimeCanon,
    newRuntimeCanon: newRun.runtimeCanon,
    tsRuntimeCanon: tsRun.runtimeCanon,
    expectedCanon: expectedCanon ?? null,
    date: new Date().toISOString().slice(0, 10),
  };
  return { ok: true, record };
}
