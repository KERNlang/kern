import { rename, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export class DefaultJournalSink {
  constructor({ journalPath, plan, bundleName, bundleDigest } = {}) {
    this.journalPath = journalPath;
    this.data = {
      schemaVersion: 1,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      plan: plan ? {
        sha: plan.sha,
        channel: plan.channel,
        version: plan.version,
      } : null,
      bundleName: bundleName || null,
      bundleDigest: bundleDigest || null,
      events: [],
      finalState: null,
    };
  }

  static async open(options) {
    const journal = new DefaultJournalSink(options);
    if (!options.journalPath) return journal;
    try {
      const existing = JSON.parse(await readFile(options.journalPath, 'utf8'));
      const samePlan =
        existing?.schemaVersion === 1 &&
        existing.plan?.sha === options.plan?.sha &&
        existing.plan?.channel === options.plan?.channel &&
        existing.plan?.version === options.plan?.version &&
        existing.bundleName === options.bundleName &&
        Array.isArray(existing.events);
      if (samePlan) {
        journal.data = existing;
        journal.data.runId = process.env.GITHUB_RUN_ID || existing.runId || null;
        journal.data.runAttempt = process.env.GITHUB_RUN_ATTEMPT || existing.runAttempt || null;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        journal.data.events.push({
          time: new Date().toISOString(),
          phase: 'journal',
          packageName: null,
          operation: 'recover-existing-evidence',
          outcome: 'failed',
          error: 'Existing journal was unreadable; evidence log restarted',
        });
      }
    }
    return journal;
  }

  async writeEvent({ phase, packageName, operation, outcome, error }) {
    const event = {
      time: new Date().toISOString(),
      phase,
      packageName: packageName || null,
      operation: operation || null,
      outcome,
      error: error ? this.redactError(error) : null,
    };
    this.data.events.push(event);
    await this.persist();
  }

  async setFinalState(finalState) {
    this.data.finalState = finalState;
    await this.persist();
  }

  async setBundleDigest(bundleDigest) {
    this.data.bundleDigest = bundleDigest;
    await this.persist();
  }

  redactError(error) {
    const msg = error.message || String(error);
    return msg
      .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED_GH_TOKEN]')
      .replace(/github_pat_[a-zA-Z0-9_]{82}/g, '[REDACTED_GH_PAT]')
      .replace(/npm_[a-zA-Z0-9]{36}/g, '[REDACTED_NPM_TOKEN]')
      .replace(/Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
      .replace(/Basic\s+[a-zA-Z0-9\-._~+/]+=*/gi, 'Basic [REDACTED]')
      .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[REDACTED_JWT]')
      .replace(/([?&](?:token|key|secret|auth|signature)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/\b((?:node_)?auth_token|token|secret|password|cookie)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .replace(/(authorization\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]');
  }

  async persist() {
    if (!this.journalPath) return;
    try {
      const dir = path.dirname(this.journalPath);
      await mkdir(dir, { recursive: true });
      const tmpPath = `${this.journalPath}.tmp`;
      const jsonStr = JSON.stringify(this.data, null, 2);
      await writeFile(tmpPath, jsonStr, 'utf8');
      await rename(tmpPath, this.journalPath);
    } catch (error) {
      console.warn(`Release journal persistence failed: ${error.code ?? 'unknown error'}`);
    }
  }
}
