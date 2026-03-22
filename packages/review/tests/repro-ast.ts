import { Project, Node, SyntaxKind } from 'ts-morph';

const project = new Project({ useInMemoryFileSystem: true });
const source = `
export function test(req: any) {
  const x = req.body.foo;
  eval(x);
}
`;

const sf = project.createSourceFile('test.ts', source);
const fn = sf.getFunctions()[0];
console.log('Function found:', fn?.getName());

if (fn) {
  const body = fn.getBody();
  console.log('Body kind:', body?.getKindName());
  
  if (body) {
    console.log('Node.isBlock(body):', Node.isBlock(body));
    
    const statements = Node.isBlock(body) ? body.getStatements() : [];
    console.log('Statements count:', statements.length);
    
    statements.forEach((stmt, i) => {
      console.log(`Statement ${i} kind:`, stmt.getKindName());
    });

    const descendants: string[] = [];
    body.forEachDescendant(n => {
      descendants.push(n.getKindName());
    });
    console.log('Descendants count:', descendants.length);
    if (descendants.length > 0) {
        console.log('First 5 descendants:', descendants.slice(0, 5));
    }
  }
}
