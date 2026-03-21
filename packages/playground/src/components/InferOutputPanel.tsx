'use client';

import { useState } from 'react';
import { PlaygroundEditor } from './PlaygroundEditor';
import { PreviewPanel } from './PreviewPanel';
import { isPreviewable } from '@/lib/preview-templates';
import type { PlaygroundTarget } from '@/lib/targets';

interface Finding {
  ruleId: string;
  severity: string;
  message: string;
  line: number;
}

interface InferOutputPanelProps {
  sourceCode: string;
  inferredKern: string | null;
  inferStats: { inputTokens: number; kernTokens: number; constructs: number; reduction: number } | null;
  target: PlaygroundTarget;
  findings?: Finding[];
}

type Tab = 'preview' | 'kern' | 'review';

export function InferOutputPanel({ sourceCode, inferredKern, inferStats, target, findings = [] }: InferOutputPanelProps) {
  const showPreview = isPreviewable(target) && sourceCode.trim().length > 0;
  const hasFindings = findings.length > 0;
  const [activeTab, setActiveTab] = useState<Tab>(showPreview ? 'preview' : 'kern');
  const effectiveTab = activeTab === 'preview' && !showPreview ? 'kern' : activeTab;

  const tabs: { key: Tab; label: string }[] = [
    ...(showPreview ? [{ key: 'preview' as Tab, label: 'Preview' }] : []),
    { key: 'kern', label: 'Inferred KERN' },
    { key: 'review', label: 'Review' },
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
            {tab.key === 'review' && hasFindings && (
              <span style={{ marginLeft: 6, color: '#ff6b6b', fontSize: 11, fontWeight: 700 }}>
                ({findings.length})
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
        {effectiveTab === 'review' && (
          <div style={{ padding: 16, overflowY: 'auto', height: '100%', fontFamily: 'var(--font-geist-mono)', fontSize: 12, lineHeight: 1.8 }}>
            {findings.length === 0 ? (
              <div style={{ color: '#4ecdc4' }}>
                <span>✓</span> No issues found. Paste vulnerable code to see kern review in action.
              </div>
            ) : (
              <>
                <div style={{ color: '#8b949e', marginBottom: 12, fontSize: 11 }}>
                  kern review — {findings.length} finding{findings.length !== 1 ? 's' : ''}
                </div>
                {findings.map((f, i) => (
                  <div key={i} style={{ marginBottom: 12, paddingLeft: 16, borderLeft: `2px solid ${f.severity === 'error' ? '#ff6b6b' : '#ffb347'}` }}>
                    <div>
                      <span style={{ color: f.severity === 'error' ? '#ff6b6b' : '#ffb347' }}>
                        {f.severity === 'error' ? '!' : '~'}
                      </span>
                      {' '}
                      <span style={{ color: f.severity === 'error' ? '#ff6b6b' : '#ffb347', fontWeight: 600 }}>
                        {f.ruleId}
                      </span>
                      <span style={{ color: '#8b949e', marginLeft: 8 }}>L{f.line}</span>
                    </div>
                    <div style={{ color: '#c9d1d9', marginTop: 2 }}>{f.message}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
