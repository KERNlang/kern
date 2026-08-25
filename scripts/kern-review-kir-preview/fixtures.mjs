import { KIR_REVIEW_FIXTURES as fixtureSet } from './fixtures/index.mjs';

// RP2/RP3 tests consume the row-oriented oracle directly.  The authoritative
// structured export remains under fixtures/ for RP0/RP4 and the gate.
export const KIR_REVIEW_FIXTURES = fixtureSet.cases;
