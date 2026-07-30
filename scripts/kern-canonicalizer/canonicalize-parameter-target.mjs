const PARAMETERS = Object.freeze([
  Object.freeze(['nodeKind', 'string[]']),
  Object.freeze(['nodeParent', 'number[]']),
  Object.freeze(['nodeOrder', 'number[]']),
  Object.freeze(['propNode', 'number[]']),
  Object.freeze(['propKey', 'string[]']),
  Object.freeze(['propValue', 'number[]']),
  Object.freeze(['valueTag', 'string[]']),
  Object.freeze(['valueParent', 'number[]']),
  Object.freeze(['valueRole', 'string[]']),
  Object.freeze(['valueOrder', 'number[]']),
  Object.freeze(['valueText', 'string[]']),
  Object.freeze(['valueBool', 'number[]']),
  Object.freeze(['maxNodeRows', 'number']),
  Object.freeze(['maxPropertyRows', 'number']),
  Object.freeze(['maxValueRows', 'number']),
]);
const PROFILE_ROWS = Object.freeze({ nodes: 100, properties: 159, values: 2556 });

export const CANONICALIZE_PARAMETER_TARGET_M4142 = Object.freeze({
  bodyDigest: '121b336b4f863035917440eed2ccd6fc3e4761e3ed632aa53b7e8d1471b43f12',
  exported: true,
  functionOrdinal: 5,
  id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
  name: 'canonicalize',
  parameters: PARAMETERS,
  path: 'examples/kern-canonicalizer/canonicalizer.kern',
  profileRows: PROFILE_ROWS,
  quotedReturns: false,
  returns: 'string[]',
  tool: 'canonicalizer',
});
