import { admitFile } from './support.mjs';

const file = process.argv[2];
if (typeof file !== 'string' || file.length === 0) {
  process.stderr.write('usage: probe-file.mjs <repository-relative .kern path>\n');
  process.exit(64);
}

try {
  process.stdout.write(`${JSON.stringify(await admitFile(file))}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ admitted: false, code: 'probe-crashed', detail: String(error?.message ?? error), file, stage: 'probe' })}\n`,
  );
}
