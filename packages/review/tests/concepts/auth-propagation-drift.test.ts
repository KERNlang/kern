import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { authPropagationDrift } from '../../src/concept-rules/auth-propagation-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

function conceptsOf(source: string, filePath: string): ConceptMap {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  return extractTsConcepts(project.createSourceFile(filePath, source), filePath);
}

function ctxFrom(files: Array<{ path: string; source: string }>, primary: string) {
  const allConcepts = new Map<string, ConceptMap>();
  for (const file of files) allConcepts.set(file.path, conceptsOf(file.source, file.path));
  const concepts = allConcepts.get(primary);
  if (!concepts) throw new Error(`missing ${primary}`);
  return { concepts, filePath: primary, allConcepts };
}

const AUTH_SERVER = `
  app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    res.json({ id: req.user.id });
  });
`;

describe('auth-propagation-drift', () => {
  it('fires for direct axios calls to guarded routes with no auth/session config', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import axios from 'axios';
            async function loadMe() {
              return axios.get('/api/me');
            }
          `,
        },
        { path: 'src/server.ts', source: AUTH_SERVER },
      ],
      'src/client.ts',
    );

    const findings = authPropagationDrift(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('auth-propagation-drift');
  });

  it('is silent when the direct client call sends Authorization', () => {
    const ctx = ctxFrom(
      [
        {
          path: 'src/client.ts',
          source: `
            import axios from 'axios';
            async function loadMe(token: string) {
              return axios.get('/api/me', { headers: { Authorization: 'Bearer ' + token } });
            }
          `,
        },
        { path: 'src/server.ts', source: AUTH_SERVER },
      ],
      'src/client.ts',
    );

    expect(authPropagationDrift(ctx)).toEqual([]);
  });

  it('does not duplicate the existing raw-fetch auth-drift rule', () => {
    const ctx = ctxFrom(
      [
        { path: 'src/client.ts', source: `await fetch('/api/me');` },
        { path: 'src/server.ts', source: AUTH_SERVER },
      ],
      'src/client.ts',
    );

    expect(authPropagationDrift(ctx)).toEqual([]);
  });
});
