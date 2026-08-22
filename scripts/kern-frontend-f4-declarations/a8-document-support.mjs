export function captureF4ADocument() {
  return Object.freeze({ args: [], fields: [], receipt: {}, policy: {} });
}

export function decodeCapturedDocument() {
  return Object.freeze({});
}

export function executeF4AComposition() {
  return Object.freeze({ envelope: 'not-implemented', runtimeInvocations: 0, fields: [] });
}

export function loadPristineF4AComposition() {
  return '';
}

export function replaceExactly() {
  return Object.freeze({ source: '', replacementCount: 0 });
}

export async function runA8DocumentMutations() {
  return [];
}

export function runA8DocumentControls() {
  return Object.freeze({});
}
