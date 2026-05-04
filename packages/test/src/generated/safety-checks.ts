// @kern-source: safety-checks:1
export const BINDING_NAME_RE: RegExp = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// @kern-source: safety-checks:3
export function isRuntimeBindingName(value: string): boolean {
  return BINDING_NAME_RE.test(value);
}

