import { type SourceFile, SyntaxKind } from 'ts-morph';
import { CLIENT_FACTORY_CALLS, CLIENT_NAME_PATTERN, NETWORK_CALLS, NETWORK_METHODS } from '../signatures.js';

/**
 * Scan `sf` for identifiers that behave like HTTP client wrappers, so that
 * `extractEffects` can emit `effect.network` for `<name>.get/post/…` calls
 * that would otherwise slip through the fixed NETWORK_CALLS/library-method
 * filter.
 *
 * Three evidence sources (all single-file, no cross-file graph resolution):
 *   1. Local class declarations whose bodies call a known network primitive
 *      somewhere — that class IS a client wrapper. The class name is used
 *      in pass 2 to mark `new <ClassName>()` instances.
 *   2. Local variable initializers that match a client factory
 *      (`axios.create(...)`, `ky.create(...)`, `got.extend(...)`) or
 *      `new <ClientClass>(...)` where <ClientClass> was found in pass 1.
 *   3. Imported identifiers from a relative / alias path whose local name
 *      matches CLIENT_NAME_PATTERN. Third-party imports are skipped —
 *      library HTTP clients are already covered by NETWORK_CALLS.
 *
 * False-positive surface is narrow on purpose: a match only translates into
 * a network effect when the identifier is later called with `.get/post/put/
 * patch/delete`, so a name match alone never produces a finding.
 */
export function collectClientIdentifiers(sf: SourceFile): Set<string> {
  const clients = new Set<string>();

  // Pass 1 — wrapper classes defined in this file.
  const clientClassNames = new Set<string>();
  for (const cls of sf.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    if (classCallsNetwork(cls)) {
      const name = cls.getName();
      if (name) clientClassNames.add(name);
    }
  }

  // Pass 2 — local instances: `const api = axios.create(...)`, `new ApiClient()`.
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.Identifier) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    const identName = nameNode.getText();

    if (init.getKind() === SyntaxKind.NewExpression) {
      const className = (init as import('ts-morph').NewExpression).getExpression().getText();
      if (clientClassNames.has(className)) clients.add(identName);
      continue;
    }

    if (init.getKind() === SyntaxKind.CallExpression) {
      const calleeText = (init as import('ts-morph').CallExpression).getExpression().getText();
      if (CLIENT_FACTORY_CALLS.has(calleeText)) clients.add(identName);
    }
  }

  // Pass 3 — imported clients with client-shaped names from local paths.
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec) continue;
    const isLocal =
      spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/') || spec.startsWith('@shared/');
    if (!isLocal) continue;
    for (const named of imp.getNamedImports()) {
      const local = named.getAliasNode()?.getText() ?? named.getNameNode().getText();
      if (CLIENT_NAME_PATTERN.test(local)) clients.add(local);
    }
    const def = imp.getDefaultImport();
    if (def && CLIENT_NAME_PATTERN.test(def.getText())) clients.add(def.getText());
  }

  return clients;
}

function classCallsNetwork(cls: import('ts-morph').ClassDeclaration): boolean {
  for (const call of cls.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const k = callee.getKind();
    if (k === SyntaxKind.Identifier) {
      if (NETWORK_CALLS.has(callee.getText())) return true;
      continue;
    }
    if (k === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      const methodName = pa.getName();
      const objText = pa.getExpression().getText();
      if (NETWORK_METHODS.has(methodName) && /^(axios|got|ky|superagent|request|http)$/.test(objText)) {
        return true;
      }
    }
  }
  return false;
}
