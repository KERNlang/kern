import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const vueConfig: ReviewConfig = { target: 'vue' };

describe('Vue Rules', () => {
  // ── missing-ref-value ──

  describe('missing-ref-value', () => {
    it('detects ref used in binary expression without .value', () => {
      const source = `
import { ref } from 'vue';
const count = ref(0);
const double = count * 2;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ref-value');
      expect(f).toBeDefined();
      expect(f!.message).toContain('count.value');
    });

    it('detects ref used in template literal without .value', () => {
      const source = `
import { ref } from 'vue';
const name = ref('world');
const greeting = \`hello \${name}\`;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ref-value');
      expect(f).toBeDefined();
    });

    it('does not flag ref.value access', () => {
      const source = `
import { ref } from 'vue';
const count = ref(0);
const double = count.value * 2;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ref-value');
      expect(f).toBeUndefined();
    });

    it('does not flag ref passed as function argument (e.g., watch(myRef))', () => {
      const source = `
import { ref, watch } from 'vue';
const count = ref(0);
watch(count, (val) => console.log(val));
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ref-value');
      expect(f).toBeUndefined();
    });

    it('detects ref used in return statement without .value', () => {
      const source = `
import { ref } from 'vue';
const count = ref(0);
function getCount() {
  return count;
}
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ref-value');
      // return statement is a flagged context
      expect(f).toBeDefined();
    });

    it('does not flag ref in shorthand property assignment', () => {
      const source = `
import { ref } from 'vue';
const count = ref(0);
const obj = { count };
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ref-value');
      expect(f).toBeUndefined();
    });
  });

  // ── missing-onUnmounted ──

  describe('missing-onUnmounted', () => {
    it('detects watch() without cleanup', () => {
      const source = `
import { watch, ref } from 'vue';
const count = ref(0);
watch(count, () => {});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeDefined();
      expect(f!.message).toContain('watch()');
    });

    it('detects watchEffect() without cleanup', () => {
      const source = `
import { watchEffect } from 'vue';
watchEffect(() => {});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeDefined();
      expect(f!.message).toContain('watchEffect()');
    });

    it('detects watchSyncEffect() without cleanup', () => {
      const source = `
import { watchSyncEffect } from 'vue';
watchSyncEffect(() => {});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeDefined();
    });

    it('detects addEventListener without removeEventListener', () => {
      const source = `
window.addEventListener('resize', handler);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeDefined();
      expect(f!.message).toContain('addEventListener');
    });

    it('does not flag watch with stop handle assigned', () => {
      const source = `
import { watch, ref } from 'vue';
const count = ref(0);
const stop = watch(count, () => {});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeUndefined();
    });

    it('does not flag when onUnmounted cleanup exists', () => {
      const source = `
import { watch, ref, onUnmounted } from 'vue';
const count = ref(0);
watch(count, () => {});
onUnmounted(() => {});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeUndefined();
    });

    it('does not flag when onBeforeUnmount cleanup exists', () => {
      const source = `
import { watch, ref, onBeforeUnmount } from 'vue';
const count = ref(0);
watch(count, () => {});
onBeforeUnmount(() => {});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted');
      expect(f).toBeUndefined();
    });

    it('does not flag addEventListener with removeEventListener', () => {
      const source = `
const handler = () => {};
window.addEventListener('resize', handler);
window.removeEventListener('resize', handler);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-onUnmounted' && f.message.includes('addEventListener'));
      expect(f).toBeUndefined();
    });
  });

  // ── setup-side-effect ──

  describe('setup-side-effect', () => {
    it('detects top-level await in defineComponent setup', () => {
      const source = `
import { defineComponent } from 'vue';
export default defineComponent({
  async setup() {
    const data = await fetch('/api');
  }
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'setup-side-effect');
      expect(f).toBeDefined();
    });

    it('detects top-level await in .vue file', () => {
      const source = `
const data = await fetch('/api');
`;
      const report = reviewSource(source, 'comp.vue', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'setup-side-effect');
      expect(f).toBeDefined();
    });

    it('does not flag non-Vue file', () => {
      const source = `
async function loadData() {
  const data = await fetch('/api');
  return data;
}
`;
      const report = reviewSource(source, 'utils.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'setup-side-effect');
      expect(f).toBeUndefined();
    });

    it('does not flag when onMounted is present', () => {
      const source = `
import { defineComponent, onMounted } from 'vue';
export default defineComponent({
  async setup() {
    onMounted(async () => {
      const data = await fetch('/api');
    });
  }
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'setup-side-effect');
      expect(f).toBeUndefined();
    });

    it('does not flag await inside nested function in setup', () => {
      const source = `
import { defineComponent } from 'vue';
export default defineComponent({
  setup() {
    async function loadData() {
      const data = await fetch('/api');
      return data;
    }
  }
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'setup-side-effect');
      expect(f).toBeUndefined();
    });

    it('does not flag await inside arrow function in setup', () => {
      const source = `
import { defineComponent } from 'vue';
export default defineComponent({
  setup() {
    const loadData = async () => {
      const data = await fetch('/api');
      return data;
    };
  }
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'setup-side-effect');
      expect(f).toBeUndefined();
    });
  });

  // ── reactive-destructure ──

  describe('reactive-destructure', () => {
    it('detects destructuring of reactive() (Vue docs pitfall)', () => {
      const source = `
import { reactive } from 'vue';
const { x, y } = reactive({ x: 0, y: 0 });
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
    });

    it('detects let destructuring of reactive()', () => {
      const source = `
import { reactive } from 'vue';
let { count } = reactive({ count: 0 });
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(f).toBeDefined();
    });

    it('does not flag direct property access (correct pattern)', () => {
      const source = `
import { reactive } from 'vue';
const state = reactive({ x: 0, y: 0 });
const x = state.x;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(f).toBeUndefined();
    });

    it('does not flag non-reactive destructuring', () => {
      const source = `
const { x, y } = someFunction();
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(f).toBeUndefined();
    });

    it('does not flag toRefs() destructuring (Vue docs fix)', () => {
      const source = `
import { reactive, toRefs } from 'vue';
const state = reactive({ foo: 1, bar: 2 });
const { foo, bar } = toRefs(state);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(f).toBeUndefined();
    });

    it('does not flag reactive without destructuring', () => {
      const source = `
import { reactive } from 'vue';
const state = reactive({ count: 0 });
console.log(state.count);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'reactive-destructure');
      expect(f).toBeUndefined();
    });
  });

  // ── computed-side-effect ──

  describe('computed-side-effect', () => {
    it('detects assignment mutation in computed', () => {
      const source = `
import { computed, ref } from 'vue';
const count = ref(0);
const double = computed(() => {
  count.value = count.value + 1;
  return count.value * 2;
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'computed-side-effect');
      expect(f).toBeDefined();
    });

    it('detects increment (++) in computed', () => {
      const source = `
import { computed, ref } from 'vue';
const count = ref(0);
const double = computed(() => {
  count.value++;
  return count.value * 2;
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'computed-side-effect');
      expect(f).toBeDefined();
    });

    it('detects fetch() call in computed', () => {
      const source = `
import { computed } from 'vue';
const data = computed(() => {
  fetch('/api/data');
  return [];
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'computed-side-effect');
      expect(f).toBeDefined();
    });

    it('does not flag pure computed (Vue docs pattern)', () => {
      const source = `
import { computed, ref } from 'vue';
const count = ref(0);
const double = computed(() => count.value * 2);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'computed-side-effect');
      expect(f).toBeUndefined();
    });

    it('does not flag computed with getter/setter object', () => {
      const source = `
import { computed, ref } from 'vue';
const firstName = ref('John');
const lastName = ref('Doe');
const fullName = computed({
  get: () => firstName.value + ' ' + lastName.value,
  set: (val: string) => { firstName.value = val.split(' ')[0]; }
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'computed-side-effect');
      expect(f).toBeUndefined();
    });

    it('detects += mutation in computed', () => {
      const source = `
import { computed, ref } from 'vue';
const total = ref(0);
const doubled = computed(() => {
  total.value += 1;
  return total.value * 2;
});
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'computed-side-effect');
      expect(f).toBeDefined();
    });
  });

  // ── shallow-ref-mutation ──

  describe('shallow-ref-mutation', () => {
    it('detects deep property mutation on shallowRef (Vue docs pitfall)', () => {
      const source = `
import { shallowRef } from 'vue';
const state = shallowRef({ count: 1 });
state.value.count = 2;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeDefined();
      expect(f!.message).toContain('shallowRef');
    });

    it('detects += deep mutation on shallowRef', () => {
      const source = `
import { shallowRef } from 'vue';
const state = shallowRef({ count: 0 });
state.value.count += 1;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeDefined();
    });

    it('does not flag direct .value reassignment (correct pattern)', () => {
      const source = `
import { shallowRef } from 'vue';
const state = shallowRef({ count: 1 });
state.value = { count: 2 };
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeUndefined();
    });

    it('does not flag when triggerRef is used', () => {
      const source = `
import { shallowRef, triggerRef } from 'vue';
const state = shallowRef({ greet: 'Hello' });
state.value.greet = 'Hi';
triggerRef(state);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeUndefined();
    });

    it('does not flag regular ref deep mutation', () => {
      const source = `
import { ref } from 'vue';
const state = ref({ count: 0 });
state.value.count = 1;
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeUndefined();
    });

    it('does not flag shallowRef without mutations', () => {
      const source = `
import { shallowRef } from 'vue';
const state = shallowRef({ count: 0 });
console.log(state.value.count);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeUndefined();
    });

    it('still flags when triggerRef is called on a DIFFERENT ref (Codex catch)', () => {
      const source = `
import { shallowRef, triggerRef } from 'vue';
const state = shallowRef({ count: 0 });
const cache = shallowRef({ data: null });
state.value.count = 1;
triggerRef(cache);
`;
      const report = reviewSource(source, 'comp.ts', vueConfig);
      const f = report.findings.find(f => f.ruleId === 'shallow-ref-mutation');
      expect(f).toBeDefined();
      expect(f!.message).toContain('state');
    });
  });
});
