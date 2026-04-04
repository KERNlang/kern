import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const terminalConfig: ReviewConfig = { target: 'terminal' };

describe('Terminal Rules', () => {
  describe('terminal-raw-mode-no-restore', () => {
    it('detects raw mode without restore', () => {
      const source = `
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (key: Buffer) => {
  if (key.toString() === 'q') process.exit();
});
`;
      const report = reviewSource(source, 'tui.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-raw-mode-no-restore');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('does not flag when raw mode is restored', () => {
      const source = `
process.stdin.setRawMode(true);
process.stdin.resume();
process.on('exit', () => {
  process.stdin.setRawMode(false);
});
`;
      const report = reviewSource(source, 'tui.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-raw-mode-no-restore');
      expect(finding).toBeUndefined();
    });
  });

  describe('terminal-readline-no-close', () => {
    it('detects readline without close', () => {
      const source = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Name? ', (answer: string) => { console.log('Hello', answer); });
`;
      const report = reviewSource(source, 'prompt.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-readline-no-close');
      expect(finding).toBeDefined();
    });

    it('does not flag when close is called', () => {
      const source = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Name? ', (answer: string) => { rl.close(); });
`;
      const report = reviewSource(source, 'prompt.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-readline-no-close');
      expect(finding).toBeUndefined();
    });
  });

  describe('terminal-missing-signal-handler', () => {
    it('detects terminal app without signal handler', () => {
      const source = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Name? ', (answer: string) => {
  console.log('Hello', answer);
  rl.close();
});
`;
      const report = reviewSource(source, 'prompt.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-missing-signal-handler');
      expect(finding).toBeDefined();
    });

    it('does not flag when SIGINT handler exists', () => {
      const source = `
import readline from 'readline';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
process.on('SIGINT', () => { rl.close(); process.exit(130); });
rl.question('Name? ', (answer: string) => { rl.close(); });
`;
      const report = reviewSource(source, 'prompt.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-missing-signal-handler');
      expect(finding).toBeUndefined();
    });
  });

  describe('terminal-unthrottled-render', () => {
    it('detects render loop under 16ms', () => {
      const source = `
function render() { process.stdout.write('frame'); }
setInterval(render, 5);
`;
      const report = reviewSource(source, 'tui.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-unthrottled-render');
      expect(finding).toBeDefined();
    });

    it('does not flag 16ms or higher intervals', () => {
      const source = `
function render() { process.stdout.write('frame'); }
setInterval(render, 16);
`;
      const report = reviewSource(source, 'tui.ts', terminalConfig);
      const finding = report.findings.find((f) => f.ruleId === 'terminal-unthrottled-render');
      expect(finding).toBeUndefined();
    });
  });
});
