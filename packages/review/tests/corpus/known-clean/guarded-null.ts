// CLEAN: nullable values properly guarded before use
export function findUser(users: Array<{ id: string; name: string }>, id: string): string {
  const user = users.find((u) => u.id === id);
  if (!user) {
    throw new Error(`User ${id} not found`);
  }
  return user.name;
}

export function getConfig(map: Map<string, string>, key: string): string {
  const value = map.get(key);
  if (value === undefined) {
    return 'default';
  }
  return value;
}
