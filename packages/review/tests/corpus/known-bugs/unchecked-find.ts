// BUG: .find() result used without null check
interface User {
  id: number;
  name: string;
}

export function getUserName(users: User[], id: number): string {
  const user = users.find((u) => u.id === id);
  return user.name; // user may be undefined
}
