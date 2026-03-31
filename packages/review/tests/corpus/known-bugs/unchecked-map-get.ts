// BUG: map.get() result used without undefined check
export function getLabel(labels: Map<string, { text: string }>, key: string): string {
  const label = labels.get(key);
  return label.text; // label may be undefined
}
