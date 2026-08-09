function fail(detail) {
  throw new Error(`evolved-hints oracle rejection: ${detail}`);
}

function selectedHint(type, snapshot) {
  const runtime = snapshot.parserHints.find((entry) => entry.type === type);
  if (runtime) return { ...runtime, source: 'runtime' };
  if (type === 'class') return { bareWord: 'name', positionalArgs: [], source: 'builtin', type };
  return { positionalArgs: [], source: 'none', type };
}

function tokenEnd(tokens, index, codeEndOffset) {
  return tokens[index + 1]?.startScalar ?? codeEndOffset;
}

function maskSource(content, writes) {
  const scalars = [...content];
  for (const write of writes) {
    for (let index = write.startScalar; index < write.endScalar; index += 1) {
      scalars[index] = ' '.repeat(scalars[index].length);
    }
  }
  return scalars.join('');
}

export function normalizeEvolvedHintsOracle(content, snapshot, stream) {
  const tokens = stream.tokens;
  let cursor = 0;
  while (tokens[cursor]?.kind === 'whitespace') cursor += 1;
  if (tokens[cursor]?.kind !== 'identifier') fail('source does not admit an identifier type');
  const admittedType = tokens[cursor].value;
  cursor += 1;
  const hint = selectedHint(admittedType, snapshot);
  const writes = [];
  const consume = (name) => {
    while (tokens[cursor]?.kind === 'whitespace') cursor += 1;
    const token = tokens[cursor];
    if (!token) return false;
    writes.push({
      endScalar: tokenEnd(tokens, cursor, stream.boundary.codeEndOffset),
      index: writes.length,
      kind: token.kind,
      name,
      source: hint.source,
      startScalar: token.startScalar,
      tokenIndex: token.index,
      value: token.value,
    });
    cursor += 1;
    return true;
  };
  for (const name of hint.positionalArgs) {
    if (!consume(name)) break;
  }
  if (hint.bareWord) {
    while (tokens[cursor]?.kind === 'whitespace') cursor += 1;
    const token = tokens[cursor];
    const keyValue = token?.kind === 'identifier' && tokens[cursor + 1]?.kind === 'equals';
    if (token?.kind === 'identifier' && !keyValue) consume(hint.bareWord);
  }
  return {
    admittedType,
    bareWord: hint.bareWord ?? '',
    exitFieldCursor: 11 + cursor * 10,
    hintSource: hint.source,
    maskedContent: maskSource(content, writes),
    positionalCount: hint.positionalArgs.length,
    writes,
  };
}
