export const MUTABLE_REGISTRY_SNAPSHOT_FIXTURES = Object.freeze([
  { id: 'unresolved', source: 'missing value=1' },
  { evolved: ['widget'], id: 'evolved', source: 'widget value=1' },
  { id: 'multiline', multiline: ['widget'], source: 'widget value=1' },
  { id: 'template', source: 'widget value=1', templates: ['widget'] },
  { evolved: ['shared'], id: 'all-overlap', multiline: ['shared'], source: 'shared value=1', templates: ['shared'] },
  { evolved: ['text'], id: 'builtin-overlap', source: 'text value=1', templates: ['text'] },
  { id: 'normalized-evolved', source: 'evolved:widget value=1', templates: ['widget'] },
  { id: 'dropped', source: '@ widget value=1', templates: ['widget'] },
]);
