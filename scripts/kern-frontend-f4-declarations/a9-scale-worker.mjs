import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadPolicy, runDocument, runModuleSet } from './worker.mjs';

const DOCUMENT_FAMILIES = Object.freeze({
  declaration: (count) => Array.from({ length: count }, (_, index) =>
    `fn name=f${index} export=true\n`).join(''),
  property: (count) => Array.from({ length: count }, (_, index) =>
    `state name=s${index} value="${index}"\n`).join(''),
  attachment: (count) => `module name=app\n  list\n${Array.from({ length: count }, (_, index) =>
    `    item value="${index}"\n`).join('')}`,
  decorator: (count) => Array.from({ length: count }, (_, index) =>
    `@trace\nfn name=f${index}\n`).join(''),
});
const FAMILIES = Object.freeze([...Object.keys(DOCUMENT_FAMILIES), 'module']);

function finiteNonnegative(value, label) {
  assert.ok(Number.isFinite(value) && value >= 0, `${label}: finite nonnegative`);
}

function semanticShape(report) {
  const { count, family } = report;
  if (family === 'declaration') {
    assert.equal(report.status, 'classified');
    assert.equal(report.declarations, count);
    assert.equal(report.propertyOccurrences, count * 2);
  } else if (family === 'property') {
    assert.equal(report.status, 'rejected');
    assert.equal(report.declarations, count);
    assert.equal(report.propertyOccurrences, count);
  } else if (family === 'attachment') {
    assert.equal(report.status, 'classified');
    assert.equal(report.declarations, count + 2);
    assert.equal(report.attachments, count + 1);
  } else if (family === 'decorator') {
    assert.equal(report.status, 'classified');
    assert.equal(report.declarations, count * 2);
    assert.equal(report.decorators, count);
    assert.equal(report.attachedDecorators, count);
  } else if (family === 'module') {
    assert.equal(report.status, 'linked');
    assert.equal(report.modules, count);
    assert.equal(report.documentRuntimeInvocations, count);
    assert.equal(report.moduleSetRuntimeInvocations, 1);
  } else {
    assert.fail(`unknown scale family ${family}`);
  }
  if (family !== 'module') assert.equal(report.runtimeInvocations, 1);
}

function metricWalls(family, walls) {
  // Envelope and work totals are deterministic protocol values; A9-C13 fixes their slack at zero.
  return [
    ['cpuMilliseconds', 'maxAdjacentCpuTimeRatio', walls.cpuTimeSlackMs, walls.maxCpuTimeMs],
    ['peakRssBytes', 'maxAdjacentRssRatio', walls.rssSlackBytes, walls.maxPeakRssBytes],
    ['envelopeBytes', 'maxAdjacentEnvelopeRatio', 0, walls.maxEnvelopeBytes],
    ['workSteps', 'maxAdjacentWorkRatio', 0,
      family === 'module' ? walls.maxModuleDocumentWorkSteps : walls.maxDocumentWorkSteps],
  ];
}

export function assertScaleReports(family, reports, walls) {
  assert.ok(FAMILIES.includes(family), `unknown scale family ${family}`);
  assert.equal(reports.length, walls.densityCounts.length, `${family}: density report count`);
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    assert.equal(report.family, family);
    assert.equal(report.count, walls.densityCounts[index]);
    semanticShape(report);
    finiteNonnegative(report.elapsedMilliseconds, `${family}: elapsedMilliseconds`);
    for (const [metric, , , absolute] of metricWalls(family, walls)) {
      finiteNonnegative(report[metric], `${family}: ${metric}`);
      assert.ok(report[metric] <= absolute,
        `${family}: ${metric} ${report[metric]} exceeds absolute ${absolute}`);
    }
    if (index === 0) continue;
    const previous = reports[index - 1];
    for (const [metric, ratioKey, slack] of metricWalls(family, walls)) {
      const limit = previous[metric] * walls[ratioKey] + slack;
      assert.ok(report[metric] <= limit,
        `${family}: ${metric} ${report[metric]} exceeds adjacent ${limit}`);
    }
  }
  return reports;
}

function documentReport(family, count) {
  const source = DOCUMENT_FAMILIES[family](count);
  const result = runDocument(`a9-${family}-${count}.kern`, source);
  return {
    status: result.receipt.status,
    runtimeInvocations: result.runtimeInvocations,
    declarations: result.receipt.declarations.length,
    propertyOccurrences: result.receipt.propertyOccurrences.length,
    attachments: result.receipt.attachments.length,
    decorators: result.receipt.decorators.length,
    attachedDecorators: result.receipt.decorators.filter((row) => row.disposition === 'attached').length,
    fields: result.fields,
    workSteps: result.receipt.workSteps,
  };
}

function moduleReport(count) {
  const modules = Array.from({ length: count }, (_, index) => ({
    moduleId: `m${index}.kern`, source: `fn name=f${index} export=true\n`,
  }));
  const result = runModuleSet(modules);
  assert.ok(Array.isArray(result.documents), 'module-set documents');
  return {
    status: result.receipt.status,
    documentRuntimeInvocations: result.documentRuntimeInvocations,
    moduleSetRuntimeInvocations: result.moduleSetRuntimeInvocations,
    modules: result.receipt.modules.length,
    fields: result.fields,
    workSteps: result.documents.reduce((total, document) => total + document.receipt.workSteps, 0),
  };
}

export function measureScale(family, count) {
  const { policy } = loadPolicy();
  assert.ok(FAMILIES.includes(family), 'scale family');
  assert.ok(policy.scalingWalls.densityCounts.includes(count), 'scale density');
  const cpuStart = process.cpuUsage();
  const elapsedStart = performance.now();
  const result = family === 'module' ? moduleReport(count) : documentReport(family, count);
  const elapsedMilliseconds = performance.now() - elapsedStart;
  const cpu = process.cpuUsage(cpuStart);
  return {
    family, count, ...result,
    cpuMilliseconds: (cpu.user + cpu.system) / 1_000,
    elapsedMilliseconds,
    peakRssBytes: process.resourceUsage().maxRSS * 1_024,
    envelopeBytes: Buffer.byteLength(JSON.stringify(result.fields), 'utf8'),
  };
}

function main() {
  const [family, rawCount] = process.argv.slice(2);
  const report = measureScale(family, Number(rawCount));
  const { fields: _fields, ...serializable } = report;
  process.stdout.write(JSON.stringify(serializable));
}

function isMainModule() {
  if (process.argv[1] === undefined) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) main();
