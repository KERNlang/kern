export const hostileModules = [
  {
    id: 'lib/math.kern',
    source: `fn name=double returns=number export=true
  param name=value type=number
  handler lang="kern"
    return value="value * 2"
`,
  },
  {
    id: 'main.kern',
    source: `use path="./lib/math"
  from name=double kind=fn as=twice export=true

fn name=main returns=void export=true
  handler lang="kern"
    let name=record value='{"__proto__": 1, "constructor": 2, "": 3, "a.b": 4, "a[b]": 5, "é": 6, "é": 7, "😀": 8}'
    let name=decimal value='Decimal.of("1.50")'
    let name=negativeZero value="-0"
    let name=pattern value="/a+/gi"
    let name=closure value="(x) => ((x + 1))"
    capability namespace=fs operation=readText name=body input="{ path: \\"input.txt\\" }"
    print value=twice(21)
`,
  },
];

export const equivalentModules = hostileModules.map((module) => ({
  ...module,
  source: module.source
    .replaceAll('lang="kern"', "lang='kern'")
    .replaceAll('(x) => ((x + 1))', '(x) => (( x+1 ))'),
}));

export const cycleModules = [
  { id: 'a.kern', source: 'use path="./b"\n  from name=b kind=fn\nfn name=a returns=void export=true\n  handler lang="kern"\n' },
  { id: 'b.kern', source: 'use path="./a"\n  from name=a kind=fn\nfn name=b returns=void export=true\n  handler lang="kern"\n' },
];
