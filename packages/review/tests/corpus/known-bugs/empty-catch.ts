// BUG: empty catch block swallows errors
export async function fetchUser(id: string) {
  try {
    const res = await fetch(`/api/users/${id}`);
    return await res.json();
  } catch (_err) {}
}
