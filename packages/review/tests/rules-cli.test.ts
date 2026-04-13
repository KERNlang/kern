import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cliConfig: ReviewConfig = { target: 'cli' };

describe('CLI Rules', () => {
  describe('cli-missing-shebang', () => {
    it('detects missing shebang in CLI entrypoint', () => {
      const source = `
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(() => {});
program.parse();
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-missing-shebang');
      expect(finding).toBeDefined();
    });

    it('does not flag files with shebang', () => {
      const source = `#!/usr/bin/env node
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(() => {});
program.parse();
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-missing-shebang');
      expect(finding).toBeUndefined();
    });
  });

  describe('cli-missing-parse', () => {
    it('detects Command without parse()', () => {
      const source = `
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(() => {});
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-missing-parse');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('does not flag when parse() is called', () => {
      const source = `
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(() => {});
program.parse();
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-missing-parse');
      expect(finding).toBeUndefined();
    });
  });

  describe('cli-async-parse-sync', () => {
    it('detects async action with sync parse()', () => {
      const source = `
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(async () => { await deploy(); });
program.parse();
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-async-parse-sync');
      expect(finding).toBeDefined();
    });

    it('does not flag when parseAsync() is used', () => {
      const source = `
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(async () => { await deploy(); });
await program.parseAsync();
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-async-parse-sync');
      expect(finding).toBeUndefined();
    });
  });

  describe('cli-process-exit-in-action', () => {
    it('detects process.exit() in action handler', () => {
      const source = `
import { Command } from 'commander';
const program = new Command();
program.command('deploy').action(() => {
  if (failed) process.exit(1);
});
program.parse();
`;
      const report = reviewSource(source, 'cli.ts', cliConfig);
      const finding = report.findings.find((f) => f.ruleId === 'cli-process-exit-in-action');
      expect(finding).toBeDefined();
    });
  });
});
