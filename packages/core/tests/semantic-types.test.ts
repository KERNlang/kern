import { mapSemanticType, SEMANTIC_TYPE_MAP } from '../src/codegen/semantic-types.js';

describe('Semantic Type Map', () => {
  test('all types map to every target', () => {
    const targets = ['prisma', 'sqlalchemy', 'pydantic', 'typescript'] as const;
    for (const kernType of Object.keys(SEMANTIC_TYPE_MAP)) {
      for (const target of targets) {
        const result = mapSemanticType(kernType, target);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });

  test('maps uuid correctly', () => {
    expect(mapSemanticType('uuid', 'prisma')).toBe('String @db.Uuid');
    expect(mapSemanticType('uuid', 'sqlalchemy')).toBe('UUID');
    expect(mapSemanticType('uuid', 'pydantic')).toBe('UUID');
    expect(mapSemanticType('uuid', 'typescript')).toBe('string');
  });

  test('maps semantic string types', () => {
    expect(mapSemanticType('Email', 'pydantic')).toBe('EmailStr');
    expect(mapSemanticType('URL', 'pydantic')).toBe('AnyHttpUrl');
    expect(mapSemanticType('text', 'sqlalchemy')).toBe('Text');
  });

  test('maps numeric types', () => {
    expect(mapSemanticType('int', 'prisma')).toBe('Int');
    expect(mapSemanticType('decimal', 'prisma')).toBe('Decimal');
    expect(mapSemanticType('Money', 'typescript')).toBe('number');
  });

  test('maps json', () => {
    expect(mapSemanticType('json', 'prisma')).toBe('Json');
    expect(mapSemanticType('json', 'pydantic')).toBe('dict[str, Any]');
  });

  test('unknown types pass through', () => {
    expect(mapSemanticType('CustomType', 'prisma')).toBe('CustomType');
  });
});
