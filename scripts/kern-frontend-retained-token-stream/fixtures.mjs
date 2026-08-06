export const RETAINED_TOKEN_STREAM_FIXTURES = Object.freeze([
  { id: 'hash-basic', source: 'text value=ok # note' },
  { id: 'slash-basic', source: 'text value=ok\t// note' },
  { id: 'record-end', source: 'text value=ok' },
  { id: 'all-token-shapes', source: 'node n=1, value="x y" expr={{ value }} style={ color:red } theme=$brand path=/a/b @' },
  { id: 'evolved-origin', source: 'evolved:name value=1' },
  { id: 'astral-prefix', source: 'text value="😀" name=after # payload' },
  { id: 'unicode-discarded', source: 'text value=ok\u00a0\u2003 # payload😀é' },
  { id: 'unclosed-string', source: 'text value="open' },
  { id: 'invalid-bigints', source: 'text first=1.2n second=2.3n' },
  { id: 'nested-expression', source: 'text value={{ outer {{ inner }} }} # payload' },
  { id: 'quoted-marker', source: 'text value="# inert // inert" name=ok' },
  { id: 'style-marker', source: 'text style={ value:# inert } name=ok' },
]);

export const EMPTY_RETAINED_FIXTURES = Object.freeze([
  { id: 'empty', source: '' },
  { id: 'ascii-space', source: '   ' },
  { id: 'ascii-tab', source: '\t\t' },
  { id: 'hash-comment-only', source: ' # payload' },
  { id: 'slash-comment-only', source: '\t// payload' },
]);
