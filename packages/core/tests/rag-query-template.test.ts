import { parseRagQueryTemplate, renderRagQueryTemplate } from '../src/index.js';

describe('RAG query templates', () => {
  test('parses typed slots and preserves duplicate compatible declarations', () => {
    expect(parseRagQueryTemplate('Find {{topic:string}} in {{year:number}} about {{topic:string}}')).toEqual({
      template: 'Find {{topic:string}} in {{year:number}} about {{topic:string}}',
      slots: [
        expect.objectContaining({ name: 'topic', type: 'string' }),
        expect.objectContaining({ name: 'year', type: 'number' }),
        expect.objectContaining({ name: 'topic', type: 'string' }),
      ],
    });
  });

  test('renders string, number, boolean, and enum params', () => {
    expect(
      renderRagQueryTemplate(
        'Find {{topic:string}} {{year:number}} {{draft:boolean}} {{section:enum(policy,billing)}}',
        {
          topic: 'refunds',
          year: 2026,
          draft: false,
          section: 'policy',
        },
      ),
    ).toBe('Find refunds 2026 false policy');
    expect(renderRagQueryTemplate('Find {{section:enum(policy,billing)}}', { section: 'policy ' })).toBe('Find policy');
  });

  test('allows duplicate enum slots with the same contract', () => {
    expect(parseRagQueryTemplate('{{section:enum(policy,billing)}} {{section:enum(policy,billing)}}').slots).toEqual([
      expect.objectContaining({ name: 'section', type: 'enum', enumValues: ['policy', 'billing'] }),
      expect.objectContaining({ name: 'section', type: 'enum', enumValues: ['policy', 'billing'] }),
    ]);
  });

  test('rejects malformed or conflicting template declarations', () => {
    expect(() => parseRagQueryTemplate('Find {{topic}}')).toThrow(/must use '\{\{name:type\}\}'/u);
    expect(() => parseRagQueryTemplate('Find {{topic:}}')).toThrow(/must declare a type/u);
    expect(() => parseRagQueryTemplate('Find {{topic:object}}')).toThrow(/unsupported type 'object'/u);
    expect(() => parseRagQueryTemplate('Find {{topic:string}} {{topic:number}}')).toThrow(/conflicting types/u);
    expect(() => parseRagQueryTemplate('Find {{section:enum()}}')).toThrow(/at least one value/u);
    expect(() => parseRagQueryTemplate('Find {{section:enum(policy,)}}')).toThrow(/must not contain empty values/u);
    expect(() => parseRagQueryTemplate('Find {{section:enum(policy,,billing)}}')).toThrow(
      /must not contain empty values/u,
    );
    expect(() => parseRagQueryTemplate('Find {{section:enum(policy,policy)}}')).toThrow(/must not repeat values/u);
    expect(() => parseRagQueryTemplate('Find {{topic:string}')).toThrow(/unmatched '\{\{'/u);
    expect(() => parseRagQueryTemplate('Find topic:string}}')).toThrow(/unmatched '\}\}'/u);
    expect(() => parseRagQueryTemplate('Find refunds')).toThrow(/at least one '\{\{name:type\}\}' slot/u);
  });

  test('rejects missing or mistyped runtime params', () => {
    expect(() => renderRagQueryTemplate('Find {{topic:string}}', undefined)).toThrow(/missing required param 'topic'/u);
    expect(() => renderRagQueryTemplate('Find {{toString:string}}', {})).toThrow(/missing required param 'toString'/u);
    expect(() =>
      renderRagQueryTemplate('Find {{topic:string}}', Object.create({ topic: 'refunds' }) as Record<string, string>),
    ).toThrow(/missing required param 'topic'/u);
    expect(() => renderRagQueryTemplate('Find {{topic:string}}', {})).toThrow(/missing required param 'topic'/u);
    expect(() => renderRagQueryTemplate('Find {{year:number}}', { year: 'twenty' })).toThrow(/finite number/u);
    expect(() => renderRagQueryTemplate('Find {{year:number}}', { year: '0x10' })).toThrow(/finite number/u);
    expect(() => renderRagQueryTemplate('Find {{draft:boolean}}', { draft: 'yes' })).toThrow(/true or false/u);
    expect(() => renderRagQueryTemplate('Find {{draft:boolean}}', { draft: 'FALSE' })).toThrow(/true or false/u);
    expect(() => renderRagQueryTemplate('Find {{section:enum(policy,billing)}}', { section: 'sales' })).toThrow(
      /one of: policy, billing/u,
    );
  });
});
