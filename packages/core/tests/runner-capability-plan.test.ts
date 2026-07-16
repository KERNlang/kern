import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  type AsyncRuntimeCapabilityHandler,
  analyzeKernSourceCapabilities,
  CAPABILITY_DESCRIPTORS,
  type CapabilityId,
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  KernCapabilityError,
} from '../src/runner.js';

function program(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

describe('@kernlang/core/runner capability preflight', () => {
  test('classifies shipped capability requirements with source lines and literal input', () => {
    const source = program([
      'capability namespace=app-http operation=queryParam name=question input="{ name: \\"question\\" }"',
      'capability namespace=storage operation=set name=setOk input="{ key: \\"theme\\", value: \\"dark\\" }"',
      'capability namespace=crypto operation=randomHex name=hex input="{ length: 4 }"',
      'capability namespace=rag operation=retrieve name=chunks input="{ question: \\"refund\\", retrieval: \\"FindDocs\\" }"',
      'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks }"',
      'capability namespace=rag operation=checkAnswer name=check input="{ query: \\"refund\\", answer: \\"Refunds follow policy.\\", chunks: chunks, groundingSpans: [{ start: 0, end: 22, chunkIndexes: [0] }] }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.parseDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(analysis.hasParseErrors).toBe(false);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.malformedCapabilities).toEqual([]);
    expect(analysis.unknownProvidedCapabilities).toEqual([]);
    expect(analysis.plannedCapabilities).toEqual([]);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.requirements.map((requirement) => requirement.id)).toEqual([
      'app-http.queryParam',
      'storage.set',
      'crypto.randomHex',
      'rag.retrieve',
      'rag.promptContext',
      'rag.checkAnswer',
    ]);
    expect(analysis.requirements[0]).toEqual(
      expect.objectContaining({
        bindingName: 'question',
        literalInput: '{ name: "question" }',
        sourceLine: 3,
      }),
    );
    expect(analysis.requirements.map((requirement) => requirement.descriptor.status)).toEqual([
      'shipped',
      'shipped',
      'shipped',
      'shipped',
      'shipped',
      'shipped',
    ]);
  });

  test('flags planned fs/net and promoted (shipped-async) llm/rag capabilities without marking them unknown', () => {
    const source = program([
      'capability namespace=fs operation=readText name=file input="{ path: \\"README.md\\" }"',
      'capability namespace=net operation=fetch name=response input="{ method: \\"GET\\", url: \\"https://example.test\\" }"',
      'capability namespace=llm operation=complete name=text input="{ prompt: \\"hello\\" }"',
      'capability namespace=rag operation=retrieveAsync name=chunks input="{ question: \\"refund\\" }"',
      'capability namespace=rag operation=answer name=answer input="{ query: \\"refund\\", chunks: [] }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.unknownCapabilities).toEqual([]);
    // fs.* and net.fetch stay preview-gated (`planned`); llm.complete and the
    // async rag ops are promoted (`shipped-async`) so they fall out of
    // plannedCapabilities even though they still need the async boundary.
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['fs.readText', 'net.fetch']);
    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'fs.readText',
      'net.fetch',
      'llm.complete',
      'rag.retrieveAsync',
      'rag.answer',
    ]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.descriptor.syncBoundary)).toEqual([
      'async-planned',
      'async-planned',
      'async-planned',
      'async-planned',
      'async-planned',
    ]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.descriptor.status)).toEqual([
      'planned',
      'planned',
      'shipped-async',
      'shipped-async',
      'shipped-async',
    ]);
  });

  test('reports async provider coverage separately from sync shipped providers', () => {
    const source = program([
      'capability namespace=fs operation=readText name=file input="{ path: \\"README.md\\" }"',
      'capability namespace=net operation=fetch name=response input="{ method: \\"GET\\", url: \\"https://example.test\\" }"',
      'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
      providedAsyncCapabilities: ['net.fetch', 'net.nope'],
    });

    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['fs.readText']);
    expect(analysis.unknownProvidedAsyncCapabilities).toEqual(['net.nope']);
    expect(analysis.asyncBoundaryRequired).toBe(true);
  });

  test('allows async capability requirements inside preview-supported try/catch shapes', () => {
    const source = program([
      'try',
      '  capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      '  catch name=e',
      '    print value="e.message"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['net.fetch'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('allows async capability requirements inside preview-supported while, for, and each loops', () => {
    const source = program([
      'let kind=let name=n value="0"',
      'while cond="n < 1"',
      '  capability namespace=llm operation=complete name=loopValue input="{ prompt: n }"',
      '  assign target=n value="n + 1"',
      'for name=i from="0" to="2"',
      '  capability namespace=llm operation=complete name=value input="{ prompt: i }"',
      'let name=items value="[1, 2]"',
      'each name=item in=items',
      '  capability namespace=llm operation=complete name=other input="{ prompt: item }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'llm.complete',
      'llm.complete',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('allows async capability requirements inside selected branch paths', () => {
    const source = program([
      'branch on="\\"paid\\""',
      '  path value="paid"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
      '  path default=true',
      '    capability namespace=llm operation=complete name=fallback input="{ prompt: \\"fallback\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'llm.complete',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('allows async try/catch requirements inside branch paths for tooling preflight', () => {
    const source = program([
      'branch on="\\"safe\\""',
      '  path value="safe"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"selected\\" }"',
      '  path value="danger"',
      '    try',
      '      capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      '      catch name=e',
      '        print value="e.message"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete', 'net.fetch'],
    });

    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.asyncPlannedCapabilities.map((requirement) => requirement.id)).toEqual([
      'llm.complete',
      'net.fetch',
    ]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('reports async capability requirements outside the main handler source execution lane', () => {
    const source = [
      'fn name=helper returns=void',
      '  handler lang="kern"',
      '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="\\"ok\\""',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['net.fetch'],
    });

    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'net.fetch',
        reason: 'outside-main',
      }),
    ]);
    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.missingAsyncProviders).toEqual([]);
  });

  test('treats async capability requirements in called helpers as async-preview executable', () => {
    const source = [
      'fn name=helper returns=number',
      '  handler lang="kern"',
      '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      '    return value="response.status"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="helper()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['net.fetch'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('treats helper calls in member-call arguments as executable capability reachability', () => {
    const source = [
      'class name=Sink',
      '  method name=accept returns=string',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      return value="value"',
      'fn name=helper returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=sink value="new Sink()"',
      '    print value="sink.accept(helper())"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.missingAsyncProviders).toEqual([]);
  });

  test('treats called class methods as executable capability reachability', () => {
    const source = [
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
      '      return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('treats class getters read from member expressions as executable capability reachability', () => {
    const source = [
      'class name=RemoteLabel',
      '  getter name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"getter\\" }"',
      '      return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new RemoteLabel()"',
      '    print value="label.read"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.missingAsyncProviders).toEqual([]);
  });

  test('fails closed for shadowed class receiver getter reachability', () => {
    const source = [
      'class name=LocalLabel',
      '  getter name=read returns=string',
      '    handler lang="kern"',
      '      return value="\\"local\\""',
      'class name=RemoteLabel',
      '  getter name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"getter\\" }"',
      '      return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new LocalLabel()"',
      '    if cond="true"',
      '      let name=label value="new RemoteLabel()"',
      '      print value="label.read"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.missingAsyncProviders).toEqual([]);
  });

  test('treats helper-returned class getters as executable capability reachability', () => {
    const source = [
      'class name=RemoteLabel',
      '  getter name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"getter\\" }"',
      '      return value="answer"',
      'fn name=makeLabel returns=RemoteLabel',
      '  handler lang="kern"',
      '    return value="new RemoteLabel()"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="makeLabel()"',
      '    print value="label.read"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['llm.complete']);
    expect(analysis.missingAsyncProviders).toEqual([]);
  });

  test('does not treat ordinary record member reads as ambiguous getter reachability', () => {
    const source = [
      'class name=RemoteLabel',
      '  getter name=text returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"getter\\" }"',
      '      return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=context value="{ text: \\"local\\" }"',
      '    print value="context.text"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.executableRequirements).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({ id: 'llm.complete', reason: 'outside-main' }),
    ]);
  });

  test('does not treat same-named methods on unrelated known receiver classes as reachable', () => {
    const source = [
      'class name=RemoteLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"method\\" }"',
      '      return value="answer"',
      'class name=LocalLabel',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="\\"local\\""',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=label value="new LocalLabel()"',
      '    print value="label.read()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.executableRequirements).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({ id: 'llm.complete', reason: 'outside-main' }),
    ]);
  });

  test('treats class constructors as executable capability reachability', () => {
    const source = [
      'class name=NeedsStorage',
      '  constructor',
      '    handler lang="kern"',
      '      capability namespace=storage operation=get name=value input="{ key: \\"mode\\" }"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new NeedsStorage()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
    });

    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['storage.get']);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('treats constructors in member-call receiver expressions as executable reachability', () => {
    const source = [
      'class name=NeedsStorage',
      '  constructor',
      '    handler lang="kern"',
      '      capability namespace=storage operation=get name=value input="{ key: \\"mode\\" }"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      return value="\\"ok\\""',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="(new NeedsStorage()).read()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
    });

    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual(['storage.get']);
    expect(analysis.missingProviders).toEqual([]);
  });

  test('owns inherited async methods and no-arg base constructors in capability reachability', () => {
    const source = [
      'class name=Base',
      '  constructor',
      '    handler lang="kern"',
      '      capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
      '  method name=read returns=string',
      '    handler lang="kern"',
      '      capability namespace=llm operation=complete name=answer input="{ prompt: \\"base\\" }"',
      '      return value="answer"',
      'class name=Child extends=Base',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Child()"',
      '    print value="item.read()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual([
      'storage.get',
      'llm.complete',
    ]);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('treats class field initializers and super-call arguments as constructor reachability', () => {
    const source = [
      'fn name=loadMode returns=string',
      '  handler lang="kern"',
      '    capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
      '    return value="mode"',
      'fn name=remoteValue returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=value input="{ prompt: \\"super\\" }"',
      '    return value="value"',
      'class name=Base',
      '  constructor',
      '    param name=value type=string',
      '    handler lang="kern"',
      '      assign target="this.value" value="value"',
      'class name=Child extends=Base',
      '  field name=mode type=string value="loadMode()"',
      '  constructor',
      '    handler lang="kern"',
      '      do value="super(remoteValue())"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let name=item value="new Child()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get'],
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.executableRequirements.map((requirement) => requirement.id)).toEqual([
      'storage.get',
      'llm.complete',
    ]);
    expect(analysis.missingProviders).toEqual([]);
    expect(analysis.missingAsyncProviders).toEqual([]);
  });

  test('reports missing async providers for called helper requirements', () => {
    const source = [
      'fn name=helper returns=number',
      '  handler lang="kern"',
      '    capability namespace=net operation=fetch name=response input="{ url: \\"https://example.test\\" }"',
      '    return value="response.status"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="helper()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: [],
    });

    expect(analysis.asyncBoundaryRequired).toBe(true);
    expect(analysis.missingAsyncProviders.map((requirement) => requirement.id)).toEqual(['net.fetch']);
    expect(analysis.unsupportedAsyncExecutions).toEqual([]);
  });

  test('does not mark helper calls from unsupported async expression slots as executable readiness', () => {
    const source = [
      'fn name=helper returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    branch on="helper()"',
      '      path value="ok"',
      '        print value="\\"ok\\""',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
  });

  test('keeps unsupported helper-call async requirements out of executable readiness when async providers are supplied', () => {
    const source = [
      'fn name=helper returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    branch on="helper()"',
      '      path value="ok"',
      '        print value="\\"ok\\""',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.executableAsyncPlannedCapabilities).toEqual([]);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
  });

  test('keeps unsupported helper-call async requirements out of executable readiness when async providers are supplied', () => {
    const source = [
      'fn name=helper returns=string',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    branch on="helper()"',
      '      path value="ok"',
      '        print value="\\"ok\\""',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.executableAsyncPlannedCapabilities).toEqual([]);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
  });

  test('does not mark helper calls from unsupported index expressions as executable readiness', () => {
    const source = [
      'fn name=helper returns=number',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    let kind=let name=xs value="[1, 2]"',
      '    print value="xs[helper()]"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
  });

  test('does not mark async helpers as executable preview helpers', () => {
    const source = [
      'fn name=helper async=true returns=number',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="helper()"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
  });

  test('does not mark helper calls from scalar-only array literals as executable readiness', () => {
    const source = [
      'fn name=helper returns=number',
      '  handler lang="kern"',
      '    capability namespace=llm operation=complete name=answer input="{ prompt: \\"helper\\" }"',
      '    return value="answer"',
      'fn name=main returns=void',
      '  handler lang="kern"',
      '    print value="String([helper()])"',
    ].join('\n');

    const analysis = analyzeKernSourceCapabilities(source, {
      providedAsyncCapabilities: ['llm.complete'],
    });

    expect(analysis.asyncBoundaryRequired).toBe(false);
    expect(analysis.missingAsyncProviders).toEqual([]);
    expect(analysis.unsupportedAsyncExecutions).toEqual([
      expect.objectContaining({
        id: 'llm.complete',
        reason: 'outside-main',
      }),
    ]);
  });

  test('reports unknown capability tokens separately from known planned capabilities', () => {
    const source = program([
      'capability namespace=foo operation=bar name=value input="{ x: 1 }"',
      'capability namespace=fs operation=list name=files input="{ path: \\".\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.requirements.map((requirement) => requirement.id)).toEqual(['fs.list']);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['fs.list']);
    expect(analysis.unknownCapabilities).toEqual([
      expect.objectContaining({
        id: 'foo.bar',
        namespace: 'foo',
        operation: 'bar',
        bindingName: 'value',
        sourceLine: 3,
      }),
    ]);
  });

  test('reports malformed capability nodes separately from unknown capabilities', () => {
    const source = program([
      'capability namespace=storage name=value input="{ key: \\"mode\\" }"',
      'capability operation=get name=value input="{ key: \\"mode\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.requirements).toEqual([]);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.malformedCapabilities).toEqual([
      expect.objectContaining({
        namespace: 'storage',
        sourceLine: 3,
        reason: expect.stringContaining('operation is required'),
      }),
      expect.objectContaining({
        operation: 'get',
        sourceLine: 4,
        reason: expect.stringContaining('namespace is required'),
      }),
    ]);
  });

  test('reports runtime-invalid capability tokens as malformed capabilities', () => {
    const source = program([
      'capability namespace="storage.v2" operation=get name=value input="{ key: \\"mode\\" }"',
      'capability namespace=storage operation="_get" name=value input="{ key: \\"mode\\" }"',
    ]);

    const analysis = analyzeKernSourceCapabilities(source);

    expect(analysis.requirements).toEqual([]);
    expect(analysis.unknownCapabilities).toEqual([]);
    expect(analysis.malformedCapabilities).toEqual([
      expect.objectContaining({
        sourceLine: 3,
        reason: expect.stringContaining("namespace 'storage.v2'"),
      }),
      expect.objectContaining({
        sourceLine: 4,
        reason: expect.stringContaining("operation '_get'"),
      }),
    ]);
  });

  test('reports missing shipped providers only when a host provider set is supplied', () => {
    const source = program([
      'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
      'capability namespace=crypto operation=randomUUID name=id',
      'capability namespace=rag operation=retrieve name=chunks input="{ question: \\"refund\\" }"',
      'capability namespace=rag operation=promptContext name=context input="{ chunks: chunks }"',
      'capability namespace=rag operation=checkAnswer name=check input="{ query: \\"refund\\", answer: \\"Refunds follow policy.\\", chunks: chunks, groundingSpans: [{ start: 0, end: 22, chunkIndexes: [0] }] }"',
      'capability namespace=net operation=fetch name=response input="{ method: \\"GET\\", url: \\"https://example.test\\" }"',
    ]);
    const provided: CapabilityId[] = ['storage.get', 'crypto.randomUUID'];

    const analysis = analyzeKernSourceCapabilities(source, { providedCapabilities: provided });

    expect(analysis.missingProviders.map((requirement) => requirement.id)).toEqual([
      'rag.retrieve',
      'rag.promptContext',
      'rag.checkAnswer',
    ]);
    expect(analysis.plannedCapabilities.map((requirement) => requirement.id)).toEqual(['net.fetch']);
  });

  test('reports unknown provided capability ids without satisfying requirements', () => {
    const source = program([
      'capability namespace=storage operation=get name=mode input="{ key: \\"mode\\" }"',
      'capability namespace=crypto operation=randomUUID name=id',
    ]);

    const analysis = analyzeKernSourceCapabilities(source, {
      providedCapabilities: ['storage.get', 'storage.nope'],
    });

    expect(analysis.unknownProvidedCapabilities).toEqual(['storage.nope']);
    expect(analysis.missingProviders.map((requirement) => requirement.id)).toEqual(['crypto.randomUUID']);
  });

  test('surfaces parse errors distinctly from an empty capability set', () => {
    const analysis = analyzeKernSourceCapabilities('fn name=main returns=void\n  handler lang="kern');

    expect(analysis.hasParseErrors).toBe(true);
    expect(analysis.parseDiagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(analysis.requirements).toEqual([]);
  });

  test('descriptor table makes remaining adapter status explicit', () => {
    expect(CAPABILITY_DESCRIPTORS['storage.get']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['crypto.randomBytes']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['rag.retrieve']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['rag.promptContext']).toEqual(expect.objectContaining({ status: 'shipped' }));
    expect(CAPABILITY_DESCRIPTORS['rag.checkAnswer']).toEqual(expect.objectContaining({ status: 'shipped' }));
    // fs.* and net.fetch remain preview-gated behind --async-preview.
    expect(CAPABILITY_DESCRIPTORS['fs.readText']).toEqual(expect.objectContaining({ status: 'planned' }));
    expect(CAPABILITY_DESCRIPTORS['fs.writeText']).toEqual(expect.objectContaining({ status: 'planned' }));
    expect(CAPABILITY_DESCRIPTORS['fs.list']).toEqual(expect.objectContaining({ status: 'planned' }));
    expect(CAPABILITY_DESCRIPTORS['net.fetch']).toEqual(expect.objectContaining({ status: 'planned' }));
    // Promoted out of --async-preview: the async runner boundary executes
    // these by default whenever async providers are supplied.
    expect(CAPABILITY_DESCRIPTORS['llm.complete']).toEqual(expect.objectContaining({ status: 'shipped-async' }));
    expect(CAPABILITY_DESCRIPTORS['rag.answer']).toEqual(expect.objectContaining({ status: 'shipped-async' }));
    expect(CAPABILITY_DESCRIPTORS['rag.ingest']).toEqual(expect.objectContaining({ status: 'shipped-async' }));
    expect(CAPABILITY_DESCRIPTORS['rag.retrieveAsync']).toEqual(expect.objectContaining({ status: 'shipped-async' }));
  });

  test('descriptor table keeps async boundary ids explicit', () => {
    expect(
      Object.values(CAPABILITY_DESCRIPTORS)
        .filter((descriptor) => descriptor.syncBoundary === 'async-planned')
        .map((descriptor) => descriptor.id)
        .sort(),
    ).toEqual([
      'fs.list',
      'fs.readText',
      'fs.writeText',
      'llm.complete',
      'net.fetch',
      'rag.answer',
      'rag.ingest',
      'rag.retrieveAsync',
    ]);
  });
});

describe('@kernlang/core/runner sync capability dispatch contract', () => {
  test('fails closed before invoking a provider with non-portable input', () => {
    expect(() =>
      invokeRunnerCapability(
        {
          storage: {
            get() {
              throw new Error('should not call provider');
            },
          },
        },
        { namespace: 'storage', operation: 'get', input: { startedAt: new Date() } as never },
      ),
    ).toThrow("runner capability 'storage.get' received a non-portable input");
  });
});

describe('@kernlang/core/runner async capability dispatch contract', () => {
  test('awaits an injected async capability provider and validates portable values', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        net: {
          async fetch(call, context) {
            return {
              ok: true,
              url: (call.input as { readonly url?: string } | undefined)?.url ?? '',
              runId: context.runId ?? null,
            };
          },
        },
      },
      { namespace: 'net', operation: 'fetch', input: { url: 'https://example.test' } },
      { runId: 'async-run' },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test', runId: 'async-run' });
  });

  test('supports namespace handler form and undefined async capability results', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        net(call) {
          if (call.operation === 'fetch') return { ok: true, url: 'https://example.test' };
          return undefined;
        },
      },
      { namespace: 'net', operation: 'fetch' },
    );
    const undefinedResult = await invokeRunnerCapabilityAsync(
      {
        net() {
          return undefined;
        },
      },
      { namespace: 'net', operation: 'fetch' },
    );

    expect(result).toEqual({ ok: true, url: 'https://example.test' });
    expect(undefinedResult).toBeUndefined();
  });

  test('fails closed for malformed, missing, thrown, non-portable input, and non-portable async results', async () => {
    await expect(
      invokeRunnerCapabilityAsync({}, { namespace: 'bad namespace', operation: 'complete' }),
    ).rejects.toThrow('runner async capability call is malformed');
    await expect(invokeRunnerCapabilityAsync({}, { namespace: 'llm', operation: 'complete' })).rejects.toThrow(
      KernCapabilityError,
    );
    await expect(
      invokeRunnerCapabilityAsync(
        {
          llm: {
            async complete() {
              throw new Error('provider down');
            },
          },
        },
        { namespace: 'llm', operation: 'complete' },
      ),
    ).rejects.toThrow("runner async capability 'llm.complete' threw: provider down");
    await expect(
      invokeRunnerCapabilityAsync(
        {
          net: {
            async fetch() {
              throw new Error('should not call provider');
            },
          },
        },
        { namespace: 'net', operation: 'fetch', input: { startedAt: new Date() } as never },
      ),
    ).rejects.toThrow("runner async capability 'net.fetch' received a non-portable input");
    await expect(
      invokeRunnerCapabilityAsync(
        {
          net: {
            async fetch() {
              return { response: new Date() } as never;
            },
          },
        },
        { namespace: 'net', operation: 'fetch' },
      ),
    ).rejects.toThrow("runner async capability 'net.fetch' returned a non-portable value");
  });
});

describe('@kernlang/core/runner async capability per-call timeout (promotion hardening)', () => {
  /**
   * A provider slower than any timeoutMs used below but that still SETTLES —
   * a genuinely-never-settling promise would leak past the test and trip
   * node:test's own "Promise resolution is still pending" leak detector.
   * Callers must await `settled` before the test ends.
   */
  function slowerThanTimeout(delayMs = 20): {
    readonly handler: AsyncRuntimeCapabilityHandler;
    readonly settled: Promise<void>;
  } {
    let resolveSettled: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve;
    });
    const handler: AsyncRuntimeCapabilityHandler = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('too-late');
          resolveSettled();
        }, delayMs);
      });
    return { handler, settled };
  }

  test('fails closed when a provider does not settle within an explicit deterministic timeoutMs', async () => {
    const { handler, settled } = slowerThanTimeout();
    await expect(
      invokeRunnerCapabilityAsync(
        { llm: { complete: handler } },
        { namespace: 'llm', operation: 'complete' },
        {},
        { timeoutMs: 5 },
      ),
    ).rejects.toThrow("runner async capability 'llm.complete' timed out after 5ms");
    await settled;
  });

  test('a timed-out call rejects with KernCapabilityError, not a raw timeout error', async () => {
    const { handler, settled } = slowerThanTimeout();
    let caught: unknown;
    try {
      await invokeRunnerCapabilityAsync(
        { llm: { complete: handler } },
        { namespace: 'llm', operation: 'complete' },
        {},
        { timeoutMs: 5 },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KernCapabilityError);
    await settled;
  });

  test('a fast provider resolves before a deterministic timeoutMs elapses', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        llm: {
          async complete() {
            return 'fast';
          },
        },
      },
      { namespace: 'llm', operation: 'complete' },
      {},
      { timeoutMs: 5_000 },
    );
    expect(result).toBe('fast');
  });

  test('timeoutMs: 0 disables the guard even for a provider slower than the default deterministic bound', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        llm: {
          async complete() {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return 'slow-but-allowed';
          },
        },
      },
      { namespace: 'llm', operation: 'complete' },
      {},
      { timeoutMs: 0 },
    );
    expect(result).toBe('slow-but-allowed');
  });

  test('a late rejection after timeout does not escape as an unhandled rejection', async () => {
    let providerRejected: Promise<void> | undefined;
    const handler: AsyncRuntimeCapabilityHandler = () => {
      providerRejected = new Promise((resolve) => {
        setTimeout(() => resolve(), 20);
      });
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('late provider failure')), 20);
      });
    };
    await expect(
      invokeRunnerCapabilityAsync(
        { llm: { complete: handler } },
        { namespace: 'llm', operation: 'complete' },
        {},
        {
          timeoutMs: 5,
        },
      ),
    ).rejects.toThrow("runner async capability 'llm.complete' timed out after 5ms");
    // Let the provider's own late rejection actually happen before the test
    // ends; if invokeRunnerCapabilityAsync did not swallow it, node:test
    // would surface an unhandled rejection and fail this test file.
    await providerRejected;
  });

  test('FAIL-CLOSED EXIT GUARD: the timeout fires even when the never-settling provider is the only pending work in the process', () => {
    // Regression (review finding): with an unref'ed timeout timer, a
    // never-settling provider that holds no other active handles let Node
    // EXIT silently before the timeout fired — no error, no timeout, empty
    // stdout. The spawned process below has NOTHING pending except the
    // provider promise and the timeout timer, so this test only passes when
    // the timer keeps the process alive until it fails closed.
    const runnerUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../dist/runner.js')).href;
    const script = [
      `const { invokeRunnerCapabilityAsync } = await import(${JSON.stringify(runnerUrl)});`,
      'const neverSettles = () => new Promise(() => {});',
      'try {',
      '  await invokeRunnerCapabilityAsync(',
      '    { llm: { complete: neverSettles } },',
      "    { namespace: 'llm', operation: 'complete' },",
      '    {},',
      '    { timeoutMs: 50 },',
      '  );',
      "  console.log('RESOLVED');",
      '} catch (error) {',
      '  console.log(`CAUGHT:${error.message}`);',
      '}',
    ].join('\n');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf-8',
      timeout: 20_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CAUGHT:runner async capability 'llm.complete' timed out after 50ms");
  });

  test('omitting timeoutMs applies the default without needing an explicit value', async () => {
    const result = await invokeRunnerCapabilityAsync(
      {
        llm: {
          async complete() {
            return 'default-timeout-ok';
          },
        },
      },
      { namespace: 'llm', operation: 'complete' },
    );
    expect(result).toBe('default-timeout-ok');
  });
});
