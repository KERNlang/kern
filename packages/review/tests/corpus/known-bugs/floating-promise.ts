// BUG: async function called without await
export async function fetchData(): Promise<string[]> {
  return ['a', 'b'];
}

export async function main() {
  fetchData(); // floating promise — return value discarded
}
