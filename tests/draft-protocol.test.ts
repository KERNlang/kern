import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Draft Protocol', () => {
  describe('parseKernDraft', () => {
    test('parses a well-formed draft block', async () => {
      const { parseKernDraft } = await import(resolve(ROOT, 'src/draft-protocol.ts'));

      const input = `draft {
  approach: "Use middleware chain with JWT validation"
  reasoning: "Standard pattern, battle-tested, works with Express"
  tradeoffs: "adds latency per request", "requires secret management"
  confidence: 82
  keyFiles: "src/auth.ts", "src/middleware.ts"
  steps {
    1: "Add jsonwebtoken dependency"
    2: "Create verifyToken middleware"
    3: "Wire into Express app.use()"
  }
}`;

      const draft = parseKernDraft(input);
      expect(draft).not.toBeNull();
      expect(draft!.approach).toBe('Use middleware chain with JWT validation');
      expect(draft!.reasoning).toContain('Standard pattern');
      expect(draft!.tradeoffs).toEqual(['adds latency per request', 'requires secret management']);
      expect(draft!.confidence).toBe(82);
      expect(draft!.keyFiles).toEqual(['src/auth.ts', 'src/middleware.ts']);
      expect(draft!.steps).toHaveLength(3);
      expect(draft!.steps[0]).toBe('Add jsonwebtoken dependency');
    });

    test('handles markdown fences around draft', async () => {
      const { parseKernDraft } = await import(resolve(ROOT, 'src/draft-protocol.ts'));

      const input = `Here is my proposal:

\`\`\`kern
draft {
  approach: "Refactor to event-driven architecture"
  reasoning: "Decouples services, enables async processing"
  tradeoffs: "complexity", "debugging harder"
  confidence: 71
  keyFiles: "src/events.ts"
  steps {
    1: "Define event types"
    2: "Create event bus"
  }
}
\`\`\`

That's my plan.`;

      const draft = parseKernDraft(input);
      expect(draft).not.toBeNull();
      expect(draft!.approach).toBe('Refactor to event-driven architecture');
      expect(draft!.confidence).toBe(71);
      expect(draft!.steps).toHaveLength(2);
    });

    test('returns null for invalid input', async () => {
      const { parseKernDraft } = await import(resolve(ROOT, 'src/draft-protocol.ts'));
      expect(parseKernDraft('just some random text')).toBeNull();
      expect(parseKernDraft('draft { }')).toBeNull();
      expect(parseKernDraft('')).toBeNull();
    });

    test('handles missing optional fields gracefully', async () => {
      const { parseKernDraft } = await import(resolve(ROOT, 'src/draft-protocol.ts'));

      const input = `draft {
  approach: "Simple fix — just change the import"
  reasoning: "One-line change"
  confidence: 95
  steps {
    1: "Change import path"
  }
}`;

      const draft = parseKernDraft(input);
      expect(draft).not.toBeNull();
      expect(draft!.approach).toBe('Simple fix — just change the import');
      expect(draft!.tradeoffs).toEqual([]);
      expect(draft!.keyFiles).toEqual([]);
      expect(draft!.steps).toHaveLength(1);
    });
  });

  describe('buildKernDraftPrompt', () => {
    test('builds brainstorm prompt', async () => {
      const { buildKernDraftPrompt } = await import(resolve(ROOT, 'src/draft-protocol.ts'));
      const prompt = buildKernDraftPrompt({
        question: 'How should we handle auth?',
        mode: 'brainstorm',
      });

      expect(prompt).toContain('How should we handle auth?');
      expect(prompt).toContain('draft {');
      expect(prompt).toContain('approach');
      expect(prompt).toContain('creative');
    });

    test('includes context when provided', async () => {
      const { buildKernDraftPrompt } = await import(resolve(ROOT, 'src/draft-protocol.ts'));
      const prompt = buildKernDraftPrompt({
        question: 'Add caching layer',
        context: 'kern-project AudioFacets { target: "nextjs" }',
        mode: 'forge-plan',
      });

      expect(prompt).toContain('AudioFacets');
      expect(prompt).toContain('Project Context');
    });

    test('builds tribunal prompt', async () => {
      const { buildKernDraftPrompt } = await import(resolve(ROOT, 'src/draft-protocol.ts'));
      const prompt = buildKernDraftPrompt({
        question: 'Should we use Redis or Memcached?',
        mode: 'tribunal-position',
      });

      expect(prompt).toContain('tribunal');
      expect(prompt).toContain('Redis or Memcached');
    });
  });

  describe('buildKernRankPrompt', () => {
    test('builds ranking prompt from drafts', async () => {
      const { buildKernRankPrompt } = await import(resolve(ROOT, 'src/draft-protocol.ts'));
      const prompt = buildKernRankPrompt([
        {
          engineId: 'codex',
          draft: {
            approach: 'Use Redis',
            reasoning: 'Fast, proven',
            tradeoffs: ['memory cost'],
            confidence: 85,
            keyFiles: ['src/cache.ts'],
            steps: ['Install redis', 'Create client', 'Wire in'],
          },
        },
        {
          engineId: 'gemini',
          draft: {
            approach: 'Use local LRU cache',
            reasoning: 'No infra needed',
            tradeoffs: ['not shared', 'limited size'],
            confidence: 72,
            keyFiles: ['src/cache.ts'],
            steps: ['Implement LRU', 'Add TTL'],
          },
        },
      ]);

      expect(prompt).toContain('codex');
      expect(prompt).toContain('gemini');
      expect(prompt).toContain('Use Redis');
      expect(prompt).toContain('Use local LRU cache');
      expect(prompt).toContain('ranked order');
    });
  });
});
