import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';
import { getActiveRules, getRuleRegistry } from '../src/rules/index.js';

const fastapiConfig: ReviewConfig = { target: 'fastapi' };

describe('FastAPI Rules', () => {
  describe('registry', () => {
    it('has fastapi rules in REGISTRY', () => {
      const registry = getRuleRegistry('fastapi');
      const fastapiRules = registry.filter(r => r.layer === 'fastapi');
      expect(fastapiRules.length).toBe(4);
    });

    it('getActiveRules returns empty array for fastapi (concept-only target)', () => {
      // FastAPI rules run via concept pipeline, not TS quality rules
      const rules = getActiveRules('fastapi');
      const fastapiSpecific = rules.filter(r => (r as any).ruleId?.startsWith('fastapi'));
      expect(fastapiSpecific.length).toBe(0);
    });
  });

  // Note: FastAPI rules operate through the Python concept pipeline
  // (reviewPythonSource → runFastapiConceptRules), not through reviewSource().
  // These tests verify the registry/metadata is correct.
  // Full integration tests require @kernlang/review-python with tree-sitter.

  describe('fastapi-sync-endpoint (regex smoke test)', () => {
    it('regex pattern matches sync endpoint in Python source', () => {
      const source = `
@app.get("/items")
def get_items():
    return [{"name": "item1"}]
`;
      // This tests the pattern directly, not through the full pipeline
      const decoratorRegex = /@(?:app|router)\.(get|post|put|delete|patch)\s*\([^)]*\)\s*\n\s*def\s+(\w+)/g;
      const match = decoratorRegex.exec(source);
      expect(match).not.toBeNull();
      expect(match![2]).toBe('get_items');
    });

    it('does not match async def endpoint', () => {
      const source = `
@app.get("/items")
async def get_items():
    return [{"name": "item1"}]
`;
      const decoratorRegex = /@(?:app|router)\.(get|post|put|delete|patch)\s*\([^)]*\)\s*\n\s*def\s+(\w+)/g;
      const match = decoratorRegex.exec(source);
      expect(match).toBeNull();
    });
  });

  describe('fastapi-broad-cors (regex smoke test)', () => {
    it('detects wildcard CORS origins', () => {
      const source = `allow_origins=["*"]`;
      const corsRegex = /allow_origins\s*=\s*\[([^\]]*)\]/;
      const match = corsRegex.exec(source);
      expect(match).not.toBeNull();
      expect(match![1]).toContain('"*"');
    });
  });
});
