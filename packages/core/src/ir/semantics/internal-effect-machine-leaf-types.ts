export const INTERNAL_EFFECT_MACHINE_LEAF_TYPES = Object.freeze([
  'assign',
  'break',
  'continue',
  'do',
  'expression-v1',
  'fmt',
  'let',
  'print',
  'return',
  'throw',
] as const);

type MachineLeafType = (typeof INTERNAL_EFFECT_MACHINE_LEAF_TYPES)[number];

export function isInternalEffectMachineLeafType(type: string): type is MachineLeafType {
  return (INTERNAL_EFFECT_MACHINE_LEAF_TYPES as readonly string[]).includes(type);
}
