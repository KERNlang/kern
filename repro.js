
import { parse } from './packages/core/src/parser.js';
import { transpileNextjs } from './packages/react/src/transpiler-nextjs.js';

const ast = parse('page name=LandingPage client=true\\n  fetch name=data url=/api/data\\n  text value=Hello');
const result = transpileNextjs(ast);
console.log(result.code);
