/// <reference types="jest" />
import type { ConceptNode, EffectPayload } from '@kernlang/core';
import { extractPythonConcepts } from '../src/mapper.js';

function isEffectNode(node: ConceptNode): node is ConceptNode & { payload: EffectPayload } {
  return node.kind === 'effect' && node.payload.kind === 'effect';
}

function backgroundTasks(source: string) {
  return extractPythonConcepts(source, 'app/api/email.py')
    .nodes.filter(isEffectNode)
    .filter((node) => node.payload.subtype === 'background-task');
}

describe('FastAPI BackgroundTasks extraction', () => {
  it('emits one background-task effect per add_task call', () => {
    const effects = backgroundTasks(`
from fastapi import BackgroundTasks

@app.post("/email")
async def send_email(background_tasks: BackgroundTasks, body: dict):
    background_tasks.add_task(send_email_func, body["to"])
    background_tasks.add_task(log_email, body["to"])
    return {"ok": True}
`);

    expect(effects).toHaveLength(2);
    expect(effects[0].payload.subtype).toBe('background-task');
    expect(effects[0].payload.target).toBe('send_email_func');
    expect(effects[0].payload.async).toBe(true);
    expect(effects[1].payload.target).toBe('log_email');
  });

  it('only fires when the param is typed BackgroundTasks', () => {
    const effects = backgroundTasks(`
@app.post("/email")
async def send_email(other: SomeOther):
    other.add_task(send_email_func)
    return {"ok": True}
`);

    expect(effects).toHaveLength(0);
  });

  it('matches against the param name, not arbitrary identifiers', () => {
    const effects = backgroundTasks(`
from fastapi import BackgroundTasks

@app.post("/email")
async def send_email(bg: BackgroundTasks):
    bg.add_task(send_email_func)
    other.add_task(should_not_match)
    return {"ok": True}
`);

    expect(effects).toHaveLength(1);
    expect(effects[0].payload.target).toBe('send_email_func');
  });

  it('records async=false for sync route handlers', () => {
    const effects = backgroundTasks(`
from fastapi import BackgroundTasks

@app.post("/email")
def send_email(background_tasks: BackgroundTasks):
    background_tasks.add_task(send_email_func)
    return {"ok": True}
`);

    expect(effects).toHaveLength(1);
    expect(effects[0].payload.async).toBe(false);
  });
});
