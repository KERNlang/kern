const { transpileMCP } = require('./packages/mcp/dist/transpiler-mcp');

function node(type, props = {}, children = []) {
  return { type, props, children, loc: { line: 1, col: 1, endLine: 1, endCol: 1 } };
}

async function test() {
  // Case 1: Auto-injection for non-path-like params (src, dest)
  const ast1 = node('mcp', { name: 'Test' }, [
    node('tool', { name: 'copy' }, [
      node('param', { name: 'src', type: 'string' }),
      node('param', { name: 'dest', type: 'string' }),
      node('handler', { code: 'await fs.copyFile(args.src, args.dest)' }),
    ]),
  ]);

  const result1 = transpileMCP(ast1);
  console.log('--- Case 1: copy(src, dest) ---');
  console.log(result1.code.includes('params["src"] = ensurePathContainment') ? '✅ Found src usage' : '❌ MISSING src usage');
  console.log(result1.code.includes('params["dest"] = ensurePathContainment') ? '✅ Found dest usage' : '❌ MISSING dest usage');

  // Case 2: Untargeted guard for 'input' param
  const ast2 = node('mcp', { name: 'Test' }, [
    node('tool', { name: 'read' }, [
      node('param', { name: 'input', type: 'string' }),
      node('guard', { type: 'pathContainment' }),
      node('handler', { code: 'return await fs.readFile(args.input)' }),
    ]),
  ]);

  const result2 = transpileMCP(ast2);
  console.log('--- Case 2: read(input) with untargeted guard ---');
  console.log(result2.code.includes('params["input"] = ensurePathContainment') ? '✅ Found input usage' : '❌ MISSING input usage');
}

test().catch(console.error);
