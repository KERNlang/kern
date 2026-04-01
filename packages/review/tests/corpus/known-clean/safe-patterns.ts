// CLEAN: all patterns are correct — no findings expected
export async function fetchUser(id: string): Promise<unknown> {
  try {
    const res = await fetch(`/api/users/${id}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch user:', err);
    throw err;
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}
