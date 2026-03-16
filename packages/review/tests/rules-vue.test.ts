import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const vueConfig: ReviewConfig = { target: 'vue' };

describe('Vue Rules', () => {
  // ── reactive-destructure ──

  describe('reactive-destructure', () => {
    it('detects destructuring of reactive()', () => {
      const source = `
import { reactive } from 'vue';

export function setup() {
  const { name, age } = reactive({ name: 'Alice', age: 30 });
  return { name, age };
}
`;
      const report = reviewSource(source, 'setup.ts', vueConfig);
      const finding = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });
  });

  // ── missing-onUnmounted ──

  describe('missing-onUnmounted', () => {
    it('detects watch without cleanup', () => {
      const source = `
import { watch, ref } from 'vue';

const count = ref(0);

export function setup() {
  watch(count, (newVal) => {
    console.log('Count changed:', newVal);
  });
}
`;
      const report = reviewSource(source, 'setup.ts', vueConfig);
      const finding = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });
  });
});
