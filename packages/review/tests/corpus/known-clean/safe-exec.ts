// CLEAN: execFileSync with array arguments — no shell injection possible
import { execFileSync } from 'child_process';

export function convertImage(inputPath: string, outputPath: string): void {
  execFileSync('convert', [inputPath, '-resize', '800x600', outputPath]);
}
