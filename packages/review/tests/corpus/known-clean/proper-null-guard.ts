// CLEAN: find() result checked for undefined before use
interface User {
  id: number;
  name: string;
}

export function getUserName(users: User[], id: number): string | null {
  const user = users.find((u) => u.id === id);
  if (!user) {
    return null;
  }
  return user.name;
}
