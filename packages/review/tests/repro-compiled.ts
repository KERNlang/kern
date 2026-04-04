import { Project } from 'ts-morph';
import { analyzeTaint } from '../dist/index.js';

const project = new Project({ useInMemoryFileSystem: true });
const source = `
export function test(req: any) {
  const x = req.body.foo;
  eval(x);
}
`;

const sf = project.createSourceFile('test.ts', source);
const inferred = [
  {
    node: {
      type: 'fn',
      props: { name: 'test', params: 'req: any' },
      children: [{ type: 'handler', props: { code: source } }],
    },
    startLine: 2,
  },
];

const results = analyzeTaint(inferred, 'test.ts', sf);
console.log('Results count:', results.length);
if (results.length > 0) {
  console.log('Paths count:', results[0].paths.length);
  console.log('Path 0 sink:', results[0].paths[0].sink.name);
}
