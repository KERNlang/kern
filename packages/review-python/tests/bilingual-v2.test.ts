/**
 * Bilingual Tests v2 — new concepts: entrypoint, guard, state_mutation, dependency
 *
 * Same concept, two languages, same shape.
 */

import { extractTsConcepts } from '@kernlang/review';
import { Project } from 'ts-morph';
import { extractPythonConcepts } from '../src/mapper.js';

function tsSourceFile(source: string, filePath = 'test.ts') {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return project.createSourceFile(filePath, source);
}

describe('Bilingual: entrypoint', () => {
  it('TS app.get route → entrypoint(route)', () => {
    const sf = tsSourceFile(`
      app.get('/users', (req, res) => { res.json([]); });
    `);
    const concepts = extractTsConcepts(sf, 'test.ts');
    const ep = concepts.nodes.find((n) => n.kind === 'entrypoint');
    expect(ep).toBeDefined();
    expect(ep!.payload.kind).toBe('entrypoint');
    if (ep!.payload.kind === 'entrypoint') {
      expect(ep!.payload.subtype).toBe('route');
    }
  });

  it('Python @app.route → same entrypoint(route)', () => {
    const source = `
from flask import Flask
app = Flask(__name__)

@app.route('/users')
def get_users():
    return []
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    const ep = concepts.nodes.find((n) => n.kind === 'entrypoint');
    expect(ep).toBeDefined();
    expect(ep!.payload.kind).toBe('entrypoint');
    if (ep!.payload.kind === 'entrypoint') {
      expect(ep!.payload.subtype).toBe('route');
    }
  });
});

describe('Bilingual: guard', () => {
  it('TS auth early-return → guard(auth)', () => {
    const sf = tsSourceFile(`
      function handler(req, res) {
        if (!req.user) return res.status(401).send('Unauthorized');
        doWork();
      }
    `);
    const concepts = extractTsConcepts(sf, 'test.ts');
    const guard = concepts.nodes.find((n) => n.kind === 'guard');
    expect(guard).toBeDefined();
    expect(guard!.payload.kind).toBe('guard');
    if (guard!.payload.kind === 'guard') {
      expect(guard!.payload.subtype).toBe('auth');
    }
  });

  it('Python @login_required → same guard(auth)', () => {
    const source = `
from django.contrib.auth.decorators import login_required

@login_required
def dashboard(request):
    return render(request, 'dashboard.html')
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    const guard = concepts.nodes.find((n) => n.kind === 'guard');
    expect(guard).toBeDefined();
    expect(guard!.payload.kind).toBe('guard');
    if (guard!.payload.kind === 'guard') {
      expect(guard!.payload.subtype).toBe('auth');
    }
  });
});

describe('Bilingual: state_mutation', () => {
  it('TS this.count++ → state_mutation(module)', () => {
    const sf = tsSourceFile(`
      class Counter {
        count = 0;
        increment() { this.count++; }
      }
    `);
    const concepts = extractTsConcepts(sf, 'test.ts');
    const mut = concepts.nodes.find((n) => n.kind === 'state_mutation');
    expect(mut).toBeDefined();
    if (mut!.payload.kind === 'state_mutation') {
      expect(mut!.payload.scope).toBe('module');
    }
  });

  it('Python self.count += 1 → same state_mutation(module)', () => {
    const source = `
class Counter:
    def __init__(self):
        self.count = 0
    def increment(self):
        self.count += 1
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    const mut = concepts.nodes.find((n) => n.kind === 'state_mutation');
    expect(mut).toBeDefined();
    if (mut!.payload.kind === 'state_mutation') {
      expect(mut!.payload.scope).toBe('module');
    }
  });
});

describe('Bilingual: dependency edges', () => {
  it('TS import → dependency edge', () => {
    const sf = tsSourceFile(`
      import express from 'express';
      import { readFile } from 'fs';
      import { helper } from './utils.js';
    `);
    const concepts = extractTsConcepts(sf, 'test.ts');
    expect(concepts.edges.length).toBeGreaterThanOrEqual(3);

    const external = concepts.edges.find((e) => e.payload.kind === 'dependency' && e.payload.subtype === 'external');
    const stdlib = concepts.edges.find((e) => e.payload.kind === 'dependency' && e.payload.subtype === 'stdlib');
    const internal = concepts.edges.find((e) => e.payload.kind === 'dependency' && e.payload.subtype === 'internal');

    expect(external).toBeDefined();
    expect(stdlib).toBeDefined();
    expect(internal).toBeDefined();
  });

  it('Python import → same dependency edge shape', () => {
    const source = `
import os
import requests
from .utils import helper
`;
    const concepts = extractPythonConcepts(source, 'test.py');
    expect(concepts.edges.length).toBeGreaterThanOrEqual(3);

    const external = concepts.edges.find((e) => e.payload.kind === 'dependency' && e.payload.subtype === 'external');
    const stdlib = concepts.edges.find((e) => e.payload.kind === 'dependency' && e.payload.subtype === 'stdlib');
    const internal = concepts.edges.find((e) => e.payload.kind === 'dependency' && e.payload.subtype === 'internal');

    expect(external).toBeDefined();
    expect(stdlib).toBeDefined();
    expect(internal).toBeDefined();
  });
});
