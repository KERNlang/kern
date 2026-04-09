import { parse } from '../src/parser.js';

describe('Reproduction: Comments and Doc Nodes', () => {
  test('current behavior of comments and doc nodes', () => {
    const source = [
      'screen name=Test',
      '  # This is a comment',
      '  // This is also a comment',
      '  doc "This is a doc node"',
      '  doc <<<',
      '    This is a multiline',
      '    doc node',
      '  >>>',
      '  text "Hello"',
    ].join('\n');

    const ast = parse(source);

    // Check if comments are preserved (they are currently NOT)
    const comments = ast.children?.filter((c: any) => c.type === 'comment');
    console.log('Comments found:', comments?.length);

    // Check doc nodes
    const docs = ast.children?.filter((c: any) => c.type === 'doc');
    console.log('Doc nodes found:', docs?.length);
    if (docs && docs.length > 0) {
      console.log('First doc node:', JSON.stringify(docs[0].props, null, 2));
      console.log('Second doc node:', JSON.stringify(docs[1].props, null, 2));
    }

    const text = ast.children?.find((c: any) => c.type === 'text');
    console.log('Text node found:', text !== undefined);
  });
});
