export const DOCUMENT_FIXTURES = Object.freeze({
  empty: '',
  duplicateProperty: 'page name=Home name=Dashboard route="/home"\n',
  missingRequired: 'page route="/home"\n',
  unknownProperty: 'page name=Home constructor=poison\n',
  unrestrictedChild: 'page name=Home\n  text value="hello"\n',
  explicitChild: 'list\n  item value="one"\n',
  invalidExplicitChild: 'list\n  text value="detached"\n    item value="still checked"\n',
  closedChild: 'decorator name=trace\n  item value="detached"\n',
  decoratorAttached: '@trace("main")\nfn name=main export=false\n',
  decoratorExported: 'export @trace("main")\nfn name=main\n',
  decoratorDropped: '@trace\ntype name=User alias=string\n',
  expressionBound: 'fn name=main\n  handler lang=kern\n    return value={{ 1 +\n+      2 }}\n',
  astralQuoted: 'page name=Home route="/hello/🌍"\n',
  unsupportedRoot: 'screen name=main\n',
  validModuleRoot: 'fn name=main export=true\n',
});

export const VALID_MODULE_SET = Object.freeze([
  {
    moduleId: 'lib/symbols.kern',
    source: 'fn name=double export=true\n  param name=value type=number\n  handler lang=kern\n    return value={{ value * 2 }}\n',
  },
  {
    moduleId: 'main.kern',
    source: 'use path="./lib/symbols"\n  from name=double kind=fn as=twice export=true\nfn name=main export=true\n',
  },
]);

export const QUARANTINE_MODULE_SET = Object.freeze([
  { moduleId: 'bad.kern', source: 'page route="/missing-name"\n' },
  { moduleId: 'blocked.kern', source: 'use path="./bad"\n  from name=bad kind=fn\nfn name=blocked export=true\n' },
  { moduleId: 'blocked-transitive.kern', source: 'use path="./blocked"\n  from name=blocked kind=fn\nfn name=top export=true\n' },
  { moduleId: 'independent.kern', source: 'fn name=independent export=true\n' },
]);
