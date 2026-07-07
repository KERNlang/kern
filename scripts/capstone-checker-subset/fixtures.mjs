import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);

function repoFile(path) {
  return {
    path,
    source: () => readFileSync(resolve(ROOT, path), 'utf8'),
  };
}

function inline(path, source) {
  return {
    path,
    source: () => `${source.trimEnd()}\n`,
  };
}

/**
 * T10 v1 corpus.
 *
 * Accept fixtures prove the checker accepts the T8 capstone assertion engine
 * itself and a tiny Map/set/get witness. Reject fixtures are the documented
 * accept-but-abstain red-team attempts from the freeze checkpoint.
 */
export const FIXTURES = Object.freeze([
  {
    id: 'accept-capstone-diag',
    expected: 'accept',
    ...repoFile('examples/capstone-assertion-engine/diag.kern'),
  },
  {
    id: 'accept-capstone-sort',
    expected: 'accept',
    ...repoFile('examples/capstone-assertion-engine/sort.kern'),
  },
  {
    id: 'accept-capstone-compare',
    expected: 'accept',
    ...repoFile('examples/capstone-assertion-engine/compare.kern'),
  },
  {
    id: 'accept-capstone-main',
    expected: 'accept',
    runnable: true,
    ...repoFile('examples/capstone-assertion-engine/main.kern'),
  },
  {
    id: 'accept-map-set-get',
    expected: 'accept',
    runnable: true,
    ...inline(
      'examples/capstone-checker-subset/fixtures/accept-map-set-get.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=m value="new Map()"
    do value="Map.set(m, \\"a\\", 1)"
    print value="Map.get(m, \\"a\\")"
`,
    ),
  },
  {
    id: 'accept-safe-int-helper',
    expected: 'accept',
    runnable: true,
    ...inline(
      'examples/capstone-checker-subset/fixtures/accept-safe-int-helper.kern',
      `
fn name=safeint params="raw:string" returns=boolean
  handler lang="kern"
    let name=n value="Text.length(raw)"
    if cond="n < 16"
      return value="true"
    if cond="n > 16"
      return value="false"
    return value="raw <= \\"9007199254740991\\""

fn name=main returns=void
  handler lang="kern"
    print value="safeint(\\"9007199254740991\\")"
`,
    ),
  },
  {
    id: 'reject-print-array',
    expected: 'reject',
    why: 'printing an array binding abstains under printContract.preconditions',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-print-array.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=xs value="[]"
    print value="xs"
`,
    ),
  },
  {
    id: 'reject-print-unsafe-int',
    expected: 'reject',
    why: 'unsafe integer print abstains',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-print-unsafe-int.kern',
      `
fn name=main returns=void
  handler lang="kern"
    print value="9007199254740992"
`,
    ),
  },
  {
    id: 'reject-print-unsafe-int-next',
    expected: 'reject',
    why: 'unsafe integer just above the first unsafe boundary also abstains',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-print-unsafe-int-next.kern',
      `
fn name=main returns=void
  handler lang="kern"
    print value="9007199254740993"
`,
    ),
  },
  {
    id: 'reject-fmt-missing-name',
    expected: 'reject',
    why: 'fmt without a portable binding name fails production fmtContract preconditions',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-fmt-missing-name.kern',
      `
fn name=main returns=void
  handler lang="kern"
    fmt template="x"
`,
    ),
  },
  {
    id: 'reject-helper-print',
    expected: 'reject',
    why: 'helper stdout side effect would make evalRunnerFunctionValue abstain',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-helper-print.kern',
      `
fn name=bad returns=number
  handler lang="kern"
    print value="\\"side\\""
    return value="1"

fn name=main returns=void
  handler lang="kern"
    print value="bad()"
`,
    ),
  },
  {
    id: 'reject-index-let-alias',
    expected: 'reject',
    why: 'let alias of a loop counter does not preserve dynamic-index provenance',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-index-let-alias.kern',
      `
fn name=pick params="xs:number[]" returns=number
  handler lang="kern"
    for name=i from=0 to="xs.length"
      let name=j value="i"
      return value="xs[j]"
    return value="0"

fn name=main returns=void
  handler lang="kern"
    let name=xs value="[]"
    do value="xs.push(1)"
    print value="pick(xs)"
`,
    ),
  },
  {
    id: 'reject-index-assign-alias',
    expected: 'reject',
    why: 'assign clears integer provenance before indexing',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-index-assign-alias.kern',
      `
fn name=pick params="xs:number[]" returns=number
  handler lang="kern"
    let name=found value="0"
    for name=i from=0 to="xs.length"
      assign target=found value="i"
    return value="xs[found]"

fn name=main returns=void
  handler lang="kern"
    let name=xs value="[]"
    do value="xs.push(1)"
    print value="pick(xs)"
`,
    ),
  },
  {
    id: 'reject-map-get-without-proof',
    expected: 'reject',
    why: 'Map.get without a preceding static set/has proof may abstain on a miss',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-map-get-without-proof.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=m value="new Map()"
    print value="Map.get(m, \\"missing\\")"
`,
    ),
  },
  {
    id: 'reject-map-delete',
    expected: 'reject',
    why: 'unsupported Map mutator poisons the static proof',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-map-delete.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=m value="new Map()"
    do value="m.delete(\\"a\\")"
`,
    ),
  },
  {
    id: 'reject-map-computed-key',
    expected: 'reject',
    why: 'v1 Map keys are literals or bare non-reassigned variables only',
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-map-computed-key.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=m value="new Map()"
    let name=k value="\\"a\\""
    do value="Map.set(m, k + \\"x\\", 1)"
    print value="Map.get(m, k + \\"x\\")"
`,
    ),
  },
]);

export const RED_TEAM_ATTEMPTS = Object.freeze(
  FIXTURES.filter((fixture) => fixture.expected === 'reject').map((fixture) => `${fixture.id}: ${fixture.why}`),
);
