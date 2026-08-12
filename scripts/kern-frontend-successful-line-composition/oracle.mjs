function fail(detail) {
  throw new Error(`successful-line oracle rejection: ${detail}`);
}

export function assertSuccessfulLineFixture(fixture) {
  if (fixture.raw.includes('\n') || fixture.raw.includes('\r')) fail(`${fixture.id} is not one logical line`);
  if (/^ *\t/u.test(fixture.raw)) fail(`${fixture.id} uses tab indentation`);
  if (!Number.isSafeInteger(fixture.expected.indent) || fixture.expected.indent < 0) {
    fail(`${fixture.id} has invalid indentation`);
  }
  if (fixture.raw.slice(0, fixture.expected.indent) !== ' '.repeat(fixture.expected.indent)) {
    fail(`${fixture.id} indentation does not match the raw line`);
  }
  const lineBody = fixture.raw.slice(fixture.expected.indent);
  if (
    lineBody.startsWith(fixture.semanticContent) === false &&
    lineBody.startsWith(`export ${fixture.semanticContent}`) === false
  ) {
    fail(`${fixture.id} semantic content is not retained from the raw line`);
  }
  return fixture.expected;
}
