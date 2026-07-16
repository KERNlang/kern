export interface RunnerCapabilityClassMemberResolution<T> {
  readonly ownerClass: string;
  readonly values: readonly T[];
}

export function runnerCapabilityClassAncestry(className: string, classExtends: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (
    let current: string | undefined = className;
    current && !seen.has(current);
    current = classExtends.get(current)
  ) {
    seen.add(current);
    out.push(current);
  }
  return out;
}

export function resolveRunnerCapabilityClassMember<T>(
  className: string,
  memberName: string,
  classMembers: ReadonlyMap<string, readonly T[]>,
  classExtends: ReadonlyMap<string, string>,
): RunnerCapabilityClassMemberResolution<T> | undefined {
  for (const ownerClass of runnerCapabilityClassAncestry(className, classExtends)) {
    const values = classMembers.get(`${ownerClass}.${memberName}`);
    if (values && values.length > 0) return { ownerClass, values };
  }
  return undefined;
}
