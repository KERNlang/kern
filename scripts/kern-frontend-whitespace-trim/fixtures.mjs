export const WHITESPACE_TRIM_FIXTURES = [
  { id: 'hash-basic', source: 'text value=ok   # note' },
  { id: 'slash-basic', source: 'text value=ok\t // note' },
  { id: 'empty-payload', source: 'text value=ok #' },
  { id: 'single-tab-trivia', source: 'text value=ok\t#note' },
  { id: 'record-end-trailing', source: 'text value=ok   ' },
  { id: 'quoted-marker', source: 'text value="hello # world"' },
  { id: 'expression-marker', source: 'text value={{ value # inert }}' },
  { id: 'style-marker', source: 'text { color: #fff }' },
  { id: 'astral-prefix', source: 'text value="😀" \u00a0 # note' },
  { id: 'unicode-payload', source: 'text value=ok # 🧭 payload' },
  { id: 'hostile-payload', source: 'text value=ok // " {{ }} # \\' },
];
