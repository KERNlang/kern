const RELOCATED_HELPER_MARKER = 'fn name=nodetablesok ';

function fail(message) {
  throw new TypeError(`historical canonicalizer layout rejection: ${message}`);
}

export function reconstructPreM4142CanonicalizerMemberLayout({
  mainSource,
  statementHelpersSource,
}) {
  const main = Buffer.from(mainSource).toString('utf8');
  const statementHelpers = Buffer.from(statementHelpersSource).toString('utf8');
  const markerIndex = statementHelpers.indexOf(RELOCATED_HELPER_MARKER);
  if (
    markerIndex <= 0 ||
    statementHelpers.indexOf(RELOCATED_HELPER_MARKER, markerIndex + 1) >= 0 ||
    main.includes(RELOCATED_HELPER_MARKER)
  ) {
    fail('the relocated helper suffix must occur exactly once in statement helpers');
  }
  const prefix = statementHelpers.slice(0, markerIndex);
  const suffix = statementHelpers.slice(markerIndex);
  if (!prefix.endsWith('\n') || !suffix.endsWith('\n') || !main.endsWith('\n')) {
    fail('member sources must retain exact trailing line boundaries');
  }
  return {
    mainSource: Buffer.from(`${main}${suffix}`),
    statementHelpersSource: Buffer.from(prefix),
  };
}
