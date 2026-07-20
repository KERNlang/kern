import { assertInternalMachineClassConstructorPlans } from './internal-effect-machine-class-construction.js';
import type { RunnerClassBinding, RunnerClassMemberBinding } from './semantic-env.js';

type ClassMemberKind = 'field' | 'getter' | 'method';

interface ClassSurfaceEntry {
  readonly arity: number;
  readonly kind: ClassMemberKind;
}

export interface InternalMachineClassMemberResolution {
  readonly cls: RunnerClassBinding;
  readonly member: RunnerClassMemberBinding;
}

export function internalMachineClassLineage(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): readonly RunnerClassBinding[] {
  const lineage: RunnerClassBinding[] = [];
  const seen = new Set<string>();
  let current: RunnerClassBinding | undefined = cls;
  while (current) {
    if (seen.has(current.name)) throw new Error(`machine class: cyclic inheritance at "${current.name}"`);
    seen.add(current.name);
    lineage.push(current);
    if (current.extendsName === undefined) break;
    const base = registry.get(current.extendsName);
    if (!base) throw new Error(`machine class: unknown base class "${current.extendsName}"`);
    if (
      !current.module ||
      !base.module ||
      current.module.functions !== base.module.functions ||
      current.module.classes !== base.module.classes
    ) {
      throw new Error(`machine class: base "${base.name}" is outside the selected root module`);
    }
    current = base;
  }
  return lineage;
}

export function internalMachineClassLineageBaseFirst(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): readonly RunnerClassBinding[] {
  return [...internalMachineClassLineage(cls, registry)].reverse();
}

function localSurface(cls: RunnerClassBinding): ReadonlyMap<string, ClassSurfaceEntry> {
  const surface = new Map<string, ClassSurfaceEntry>();
  const add = (name: string, entry: ClassSurfaceEntry): void => {
    if (surface.has(name)) throw new Error(`machine class: conflicting member "${cls.name}.${name}"`);
    surface.set(name, entry);
  };
  for (const field of cls.fields) add(field.name, { arity: 0, kind: 'field' });
  for (const [name, method] of cls.methods) add(name, { arity: method.params.length, kind: 'method' });
  for (const name of cls.getters.keys()) add(name, { arity: 0, kind: 'getter' });
  return surface;
}

function assertLineageSurface(cls: RunnerClassBinding, registry: ReadonlyMap<string, RunnerClassBinding>): void {
  const surface = new Map<string, ClassSurfaceEntry>();
  for (const candidate of internalMachineClassLineageBaseFirst(cls, registry)) {
    for (const [name, entry] of localSurface(candidate)) {
      const inherited = surface.get(name);
      if (inherited && inherited.kind !== entry.kind) {
        throw new Error(`machine class: inherited member "${name}" changes kind`);
      }
      if (inherited?.kind === 'method' && inherited.arity !== entry.arity) {
        throw new Error(`machine class: inherited method "${name}" changes arity`);
      }
      surface.set(name, entry);
    }
  }
}

export function assertInternalMachineClassInheritance(registry: ReadonlyMap<string, RunnerClassBinding>): void {
  assertInternalMachineClassConstructorPlans(registry);
  for (const cls of registry.values()) {
    const lineage = internalMachineClassLineage(cls, registry);
    if (lineage.length > 1) assertLineageSurface(cls, registry);
  }
}

export function internalMachineClassVisibleFields(
  cls: RunnerClassBinding,
  registry: ReadonlyMap<string, RunnerClassBinding>,
): ReadonlySet<string> {
  return new Set(
    internalMachineClassLineage(cls, registry).flatMap((candidate) => candidate.fields.map((field) => field.name)),
  );
}

export function internalMachineClassMemberFor(
  cls: RunnerClassBinding,
  name: string,
  kind: 'getter' | 'method',
  registry: ReadonlyMap<string, RunnerClassBinding>,
): InternalMachineClassMemberResolution | undefined {
  for (const candidate of internalMachineClassLineage(cls, registry)) {
    const member = kind === 'method' ? candidate.methods.get(name) : candidate.getters.get(name);
    if (member) return { cls: candidate, member };
  }
  return undefined;
}
