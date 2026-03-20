'use client';

import { useState } from 'react';
import { PlaygroundEditor } from './PlaygroundEditor';
import { PreviewPanel } from './PreviewPanel';
import { isPreviewable } from '@/lib/preview-templates';
import type { PlaygroundTarget } from '@/lib/targets';

interface InferOutputPanelProps {
  sourceCode: string;
  inferredKern: string | null;
  inferStats: { inputTokens: number; kernTokens: number; constructs: number; reduction: number } | null;
  target: PlaygroundTarget;
}

type Tab = 'preview' | 'kern';

export function InferOutputPanel({ sourceCode, inferredKern, inferStats, target }: InferOutputPanelProps) {
  const showPreview = isPreviewable(target) && sourceCode.trim().length > 0;
  const [activeTab, setActiveTab] = useState<Tab>(showPreview ? 'preview' : 'kern');
  const effectiveTab = activeTab === 'preview' && !showPreview ? 'kern' : activeTab;

  const tabs: { key: Tab; label: string }[] = [
    ...(showPreview ? [{ key: 'preview' as Tab, label: 'Preview' }] : []),
    { key: 'kern', label: 'Inferred KERN' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid #30363d',
        background: '#161b22',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 500,
              color: effectiveTab === tab.key ? '#e6edf3' : '#8b949e',
              background: effectiveTab === tab.key ? '#0d1117' : 'transparent',
              border: 'none',
              borderBottom: effectiveTab === tab.key ? '2px solid #ff6b6b' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {tab.label}
            {tab.key === 'kern' && inferStats && (
              <span style={{ marginLeft: 6, color: '#4ecdc4', fontSize: 11 }}>
                ({inferStats.constructs})
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {effectiveTab === 'preview' && showPreview && (
          <PreviewPanel compiledCode={sourceCode} target={target} />
        )}
        {effectiveTab === 'kern' && (
          <PlaygroundEditor
            value={inferredKern ?? '// Paste TypeScript or React code on the left'}
            onChange={() => {}}
            language="kern"
            readOnly
          />
        )}
      </div>
    </div>
  );
}
