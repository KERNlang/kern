import { transpileMCP } from './packages/mcp/src/transpiler-mcp.js';
import { node } from './packages/core/src/ir.js';

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
  console.log(result1.code.includes('ensurePathContainment') ? '✅ Found path containment' : '❌ MISSING path containment');

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
  console.log(result2.code.includes('ensurePathContainment') ? '✅ Found path containment' : '❌ MISSING path containment');

  // Case 3: Untargeted sanitize guard for 'query' param
  const ast3 = node('mcp', { name: 'Test' }, [
    node('tool', { name: 'search' }, [
      node('param', { name: 'query', type: 'string' }),
      node('guard', { type: 'sanitize' }),
      node('handler', { code: 'await exec("grep " + args.query)' }),
    ]),
  ]);

  const result3 = transpileMCP(ast3);
  console.log('--- Case 3: search(query) with untargeted sanitize guard ---');
  console.log(result3.code.includes('sanitizeValue') ? '✅ Found sanitize' : '❌ MISSING sanitize');
}

test().catch(console.error);
