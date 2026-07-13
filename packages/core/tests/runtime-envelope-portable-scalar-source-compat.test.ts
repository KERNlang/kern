import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const fixture = fileURLToPath(new URL('./fixtures/portable-scalar-4.5-source-compat.ts', import.meta.url));

describe('portable scalar 4.5 source compatibility', () => {
  test('type-checks the complete frozen export-name and call-signature fixture', () => {
    const program = ts.createProgram([fixture], {
      esModuleInterop: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: ['node'],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      diagnostics.map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        const file = diagnostic.file?.fileName ?? '<unknown>';
        return `${file}:${diagnostic.start ?? 0} TS${diagnostic.code}: ${message}`;
      }),
    ).toEqual([]);
  });
});
