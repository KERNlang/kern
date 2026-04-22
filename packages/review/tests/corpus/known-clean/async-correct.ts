// CLEAN: all async calls properly awaited and error-handled
export async function fetchData(): Promise<string[]> {
  const res = await fetch('/api/data');
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.json();
}

export async function main() {
  try {
    const data = await fetchData();
    console.log(data);
  } catch (err) {
    console.error('Failed:', err);
  }
}

export function fireAndForget() {
  void fetchData(); // intentional — void marks fire-and-forget, not async
}
