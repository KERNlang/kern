import {
  loadPristineF4AComposition,
  runA8DocumentControls,
  runA8DocumentMutations,
} from './a8-document-support.mjs';
import {
  runA8ModuleSetControls,
  runA8PostSortMutation,
} from './a8-module-set-support.mjs';
import { runA8SourceOwnership } from './a8-source-canaries.mjs';
import { loadPolicy } from './worker.mjs';

export const A8_FAMILY_IDS = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `A8-F${index + 1}`),
);

const familyOrdinal = ({ id }) => Number(id.slice('A8-F'.length));

export async function runA8MutationMatrix() {
  const source = loadPristineF4AComposition(loadPolicy().policy);
  const reports = [
    ...runA8SourceOwnership(source),
    ...await runA8DocumentMutations(),
    runA8PostSortMutation(),
  ].sort((left, right) => familyOrdinal(left) - familyOrdinal(right));
  if (reports.length !== A8_FAMILY_IDS.length ||
      reports.some(({ id }, index) => id !== A8_FAMILY_IDS[index])) {
    throw new Error(`A8 mutation registry drift: ${reports.map(({ id }) => id).join(',')}`);
  }
  return reports;
}

export async function runA8AdditionalControls() {
  const document = runA8DocumentControls();
  const moduleSet = runA8ModuleSetControls();
  if (document.c13ExactControl !== 'ok' || document.c13ExactLimit !== 'limit') {
    throw new Error('A8 C13 control drift');
  }
  return Object.freeze({
    permutationsGenerated: moduleSet.permutationsGenerated,
    permutationsAttempted: moduleSet.permutationsAttempted,
    permutationsMatched: moduleSet.permutationsMatched,
    compositionSkewRejected: document.compositionSkewRejected,
    staleAuthorityRejected: document.staleAuthorityRejected,
    c13ClaimMutationsRejected: document.c13ClaimMutationsRejected,
    oracleCanariesRejected: moduleSet.oracleCanariesRejected,
  });
}
