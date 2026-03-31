// BUG: readFileSync inside an async function — blocks event loop
import { readFileSync } from 'fs';

export async function loadConfig(path: string): Promise<Record<string, unknown>> {
  const raw = readFileSync(path, 'utf-8'); // sync I/O in async context
  return JSON.parse(raw) as Record<string, unknown>;
}
