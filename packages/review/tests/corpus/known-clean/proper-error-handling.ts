// CLEAN: try/catch with proper logging and rethrow — no swallowed errors
export async function fetchData(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('fetchData failed:', err);
    throw err;
  }
}
