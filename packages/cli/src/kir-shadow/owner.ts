import { hasKirShadowOption, parseKirShadowInvocation } from './arguments.js';
import { compileShadowTargets } from './compile-report.js';
import { KIR_SHADOW_CHILD_MAX_BYTES, KIR_SHADOW_ERROR_MAX_BYTES } from './limits.js';
import { projectShadowInput } from './projection-input.js';
import { buildRunReport } from './run-report.js';
import type { KirShadowCommand, KirShadowEntry } from './types.js';
import { KirShadowAdmissionError, KirShadowUnavailableError } from './types.js';

export const KERN_CLI_KIR_SHADOW_OWNER = 'kern.cli.kir-shadow.owner.v1' as const;

interface ShadowEnvelope {
  readonly command: KirShadowCommand;
  readonly format: 'kern.cli.kir-shadow.v1';
  readonly outcome: 'match' | 'mismatch' | 'unavailable';
  readonly report: unknown;
}

type ProjectionState =
  | { readonly status: 'unavailable' }
  | { readonly artifactSha256: string; readonly status: 'projected' };

function writeError(message: string): void {
  const safe = message.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) => {
    return `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0')}`;
  });
  let bounded = '';
  let bytes = 1; // Reserve the trailing newline inside the public byte limit.
  for (const character of `KERN_CLI_KIR_SHADOW: ${safe}`) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > KIR_SHADOW_ERROR_MAX_BYTES) break;
    bounded += character;
    bytes += characterBytes;
  }
  process.stderr.write(`${bounded}\n`);
}

function writeReport(envelope: ShadowEnvelope): void {
  const output = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(output) > KIR_SHADOW_CHILD_MAX_BYTES) throw new Error('shadow report exceeds bound');
  process.stdout.write(output);
}

function unavailableReport(
  command: KirShadowCommand,
  entry: KirShadowEntry,
  code: string,
  projection: ProjectionState,
): ShadowEnvelope {
  return {
    command,
    format: 'kern.cli.kir-shadow.v1',
    outcome: 'unavailable',
    report: {
      entry,
      error: { code },
      projection,
    },
  };
}

export async function runKirShadowIfRequested(command: KirShadowCommand, args: readonly string[]): Promise<boolean> {
  if (!hasKirShadowOption(args)) return false;
  let entry: KirShadowEntry | undefined;
  let projection: ProjectionState = { status: 'unavailable' };
  try {
    const invocation = parseKirShadowInvocation(command, args);
    entry = invocation.entry;
    const projected = await projectShadowInput(invocation.file, invocation.entry);
    projection = { artifactSha256: projected.artifactSha256, status: 'projected' };
    if (command === 'compile') {
      const { report: targets } = compileShadowTargets(projected.verified, invocation.entry, projected.artifactSha256);
      writeReport({
        command,
        format: 'kern.cli.kir-shadow.v1',
        outcome: 'match',
        report: {
          entry: invocation.entry,
          projection: { artifactSha256: projected.artifactSha256, status: 'projected' },
          targets,
        },
      });
      process.exitCode = 0;
      return true;
    }
    const execution = await buildRunReport(projected.verified, projected.artifactSha256, invocation.entry);
    writeReport({ command, format: 'kern.cli.kir-shadow.v1', ...execution });
    process.exitCode = execution.outcome === 'match' ? 0 : 2;
    return true;
  } catch (error) {
    if (error instanceof KirShadowAdmissionError) {
      writeError(error.message);
      process.exitCode = 2;
      return true;
    }
    if (error instanceof KirShadowUnavailableError && entry) {
      writeReport(unavailableReport(command, entry, error.code, projection));
      process.exitCode = 2;
      return true;
    }
    writeError('unexpected adapter failure');
    process.exitCode = 1;
    return true;
  }
}
