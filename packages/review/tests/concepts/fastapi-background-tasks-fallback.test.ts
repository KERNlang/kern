import type { ConceptNode, EffectPayload } from '@kernlang/core';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

function isEffectNode(node: ConceptNode): node is ConceptNode & { payload: EffectPayload } {
  return node.kind === 'effect' && node.payload.kind === 'effect';
}

function backgroundTasks(source: string) {
  return extractPythonConceptsFallback(source, 'app/api/email.py')
    .nodes.filter(isEffectNode)
    .filter((node) => node.payload.subtype === 'background-task');
}

describe('FastAPI BackgroundTasks fallback extraction', () => {
  it('emits one background-task effect per add_task call', () => {
    const effects = backgroundTasks(`from fastapi import BackgroundTasks

@app.post("/email")
async def send_email(background_tasks: BackgroundTasks, body: dict):
    background_tasks.add_task(send_email_func, body["to"])
    background_tasks.add_task(log_email, body["to"])
    return {"ok": True}
`);

    expect(effects).toHaveLength(2);
    expect(effects[0].payload.target).toBe('send_email_func');
    expect(effects[1].payload.target).toBe('log_email');
  });

  it('does not fire when no BackgroundTasks param is typed', () => {
    const effects = backgroundTasks(`@app.post("/email")
async def send_email(other: SomeOther):
    other.add_task(send_email_func)
    return {"ok": True}
`);

    expect(effects).toHaveLength(0);
  });

  it('handles add_task(func=...) keyword form', () => {
    const effects = backgroundTasks(`from fastapi import BackgroundTasks

@app.post("/email")
async def send_email(background_tasks: BackgroundTasks):
    background_tasks.add_task(func=send_email_func, to="x@y")
    return {"ok": True}
`);

    expect(effects).toHaveLength(1);
    expect(effects[0].payload.target).toBe('send_email_func');
  });

  it('leaves target undefined when only non-func kwargs are passed', () => {
    const effects = backgroundTasks(`from fastapi import BackgroundTasks

@app.post("/email")
async def send_email(background_tasks: BackgroundTasks):
    background_tasks.add_task(arg=value)
    return {"ok": True}
`);

    expect(effects).toHaveLength(1);
    expect(effects[0].payload.target).toBeUndefined();
  });

  it('matches the named param only', () => {
    const effects = backgroundTasks(`from fastapi import BackgroundTasks

@app.post("/email")
async def send_email(bg: BackgroundTasks):
    bg.add_task(send_email_func)
    unrelated.add_task(should_not_match)
    return {"ok": True}
`);

    expect(effects).toHaveLength(1);
    expect(effects[0].payload.target).toBe('send_email_func');
  });
});
