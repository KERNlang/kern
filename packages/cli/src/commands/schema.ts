import { exportSchemaJSON } from '@kernlang/core';

export function runSchema(_args: string[]): void {
  const schema = exportSchemaJSON();
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}
