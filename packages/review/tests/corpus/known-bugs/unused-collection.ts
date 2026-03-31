// BUG: array created and populated but never read
export function processUsers(names: string[]): void {
  const results: string[] = [];
  for (const name of names) {
    results.push(name.trim().toLowerCase());
  }
  // results is never returned or used
  console.log('done');
}
