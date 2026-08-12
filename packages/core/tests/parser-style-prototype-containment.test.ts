import { parseStyleBlock } from '../src/parser-style.js';

describe('Parser style prototype containment', () => {
  test('an inherited pseudo-style name is ignored before any nested write', () => {
    const pollutionKey = 'parserStylePollutionProbe';
    const pseudoStyles: Record<string, Record<string, string>> = {};
    const hostObject = Object as unknown as Record<string, unknown>;
    delete hostObject[pollutionKey];

    try {
      parseStyleBlock(`:constructor:${pollutionKey}:yes`, {}, pseudoStyles);

      expect(hostObject[pollutionKey]).toBeUndefined();
      expect(Object.hasOwn(pseudoStyles, 'constructor')).toBe(false);
      expect(pseudoStyles).toEqual({});
    } finally {
      delete hostObject[pollutionKey];
    }
  });
});
