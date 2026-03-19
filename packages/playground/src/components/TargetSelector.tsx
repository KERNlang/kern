'use client';

import { PLAYGROUND_TARGETS, TARGET_LABELS } from '@/lib/targets';
import type { PlaygroundTarget } from '@/lib/targets';

interface TargetSelectorProps {
  value: PlaygroundTarget;
  onChange: (target: PlaygroundTarget) => void;
}

export function TargetSelector({ value, onChange }: TargetSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PlaygroundTarget)}
      style={{
        background: '#21262d',
        color: '#e6edf3',
        border: '1px solid #30363d',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 13,
        fontFamily: 'inherit',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {PLAYGROUND_TARGETS.map((target) => (
        <option key={target} value={target}>
          {TARGET_LABELS[target]}
        </option>
      ))}
    </select>
  );
}
