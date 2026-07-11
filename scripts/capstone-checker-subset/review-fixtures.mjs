function inline(path, source) {
  return {
    path,
    source: () => `${source.trimEnd()}\n`,
  };
}

export const REVIEW_FIXTURES = Object.freeze([
  {
    id: 'reject-while-logical-number-operands',
    expected: 'reject',
    why: 'logical operators are not boolean proofs because they return an operand',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-logical-number-operands.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="1 || 2"
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-while-negated-false',
    expected: 'reject',
    why: 'unary negation is not a boundedness proof and !false is statically true',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-negated-false.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="!false"
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-while-mismatched-literal-comparison',
    expected: 'reject',
    why: 'a comparison root is not executable when literal operand types differ',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-mismatched-literal-comparison.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="1 < \"x\""
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-while-array-comparison',
    expected: 'reject',
    why: 'array operands are outside the portable scalar comparison contract',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-array-comparison.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="[] == []"
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-while-array-binding-comparison',
    expected: 'reject',
    why: 'an identifier operand needs scalar provenance, not only identifier syntax',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-array-binding-comparison.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=xs value="[]"
    while cond="xs == xs"
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-while-binding-declared-after-loop',
    expected: 'reject',
    why: 'a later declaration cannot prove the condition at the loop entry',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-binding-declared-after-loop.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="i < 1"
      print value="\"unreachable\""
    let name=i value="0"
`,
    ),
  },
  {
    id: 'reject-while-missing-length-receiver',
    expected: 'reject',
    why: 'a length bound must resolve to a known string or array binding',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-missing-length-receiver.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=i value="0"
    while cond="i < missing.length"
      assign target=i value="i + 1"
`,
    ),
  },
  {
    id: 'reject-while-constant-true-comparison',
    expected: 'reject',
    why: 'a statically true literal comparison is equivalent to literal true',
    expectedRejects: ['T10_WHILE|reject|literal_true'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-constant-true-comparison.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="1 == 1"
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-while-conditionally-declared-binding',
    expected: 'reject',
    why: 'a declaration under an earlier branch is not definitely available at loop entry',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-conditionally-declared-binding.kern',
      `
fn name=main returns=void
  handler lang="kern"
    if cond="false"
      let name=i value="0"
    while cond="i < 1"
      assign target=i value="i + 1"
`,
    ),
  },
  {
    id: 'reject-while-wrong-direction-step',
    expected: 'reject',
    why: 'a less-than induction variable must advance by a positive addition',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-wrong-direction-step.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=i value="0"
    while cond="i < 1"
      assign target=i value="i - 1"
`,
    ),
  },
  {
    id: 'reject-while-zero-step',
    expected: 'reject',
    why: 'a zero induction step cannot make progress toward the bound',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-zero-step.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=i value="0"
    while cond="i < 1"
      assign target=i value="i + 0"
`,
    ),
  },
  {
    id: 'reject-while-shadowed-progress',
    expected: 'reject',
    why: 'an inner let shadows the induction binding, so its assignment cannot prove outer-loop progress',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-shadowed-progress.kern',
      `
fn name=main returns=void
  handler lang="kern"
    let name=i value="0"
    while cond="i < 1"
      let name=i value="0"
      assign target=i value="i + 1"
`,
    ),
  },
  {
    id: 'reject-while-unsafe-literal-equality',
    expected: 'reject',
    why: 'unsafe numeric literals cannot become a checker-side literal proof',
    expectedRejects: ['T10_WHILE|reject|non_boolean_condition'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-while-unsafe-literal-equality.kern',
      `
fn name=main returns=void
  handler lang="kern"
    while cond="9007199254740992 == 9007199254740992"
      print value="\"unreachable\""
`,
    ),
  },
  {
    id: 'reject-index-shadowed-parameter',
    expected: 'reject',
    why: 'a local binding that shadows a proven parameter destroys its provenance',
    expectedRejects: ['T10_INDEX|reject|missing_provenance'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-index-shadowed-parameter.kern',
      `
fn name=pick params="xs:number[],idx:number" returns=number
  handler lang="kern"
    let name=idx value="\"bad\""
    return value="xs[idx]"

fn name=main returns=void
  handler lang="kern"
    let name=xs value="[]"
    do value="xs.push(1)"
    print value="pick(xs, 0)"
`,
    ),
  },
  {
    id: 'reject-index-partially-proven-arithmetic',
    expected: 'reject',
    why: 'one safe arithmetic operand cannot prove the other operand is an integer',
    expectedRejects: ['T10_INDEX|reject|missing_provenance'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-index-partially-proven-arithmetic.kern',
      `
fn name=pick params="xs:number[],idx:number" returns=number
  handler lang="kern"
    return value="xs[idx]"

fn name=main returns=void
  handler lang="kern"
    let name=xs value="[]"
    let name=bad value="\"bad\""
    do value="xs.push(1)"
    print value="pick(xs, 0 + bad)"
`,
    ),
  },
  {
    id: 'reject-call-through-original-import-name',
    expected: 'reject',
    why: 'an aliased import binds only its local alias',
    expectedRejects: ['T10_SURFACE|reject|unsupported_call'],
    ...inline(
      'examples/capstone-checker-subset/fixtures/reject-call-through-original-import-name.kern',
      `
use path="./helper.kern"
  from name=original kind=fn as=alias

fn name=main returns=void
  handler lang="kern"
    print value="original()"
`,
    ),
  },
]);
