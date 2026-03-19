'use client';

import { useState } from 'react';
import { PlaygroundEditor } from './PlaygroundEditor';

interface OutputPanelProps {
  ir: string | null;
  output: string | null;
  outputLanguage: string;
  artifacts: Array<{ path: string; content: string; type: string }>;
}

type Tab = 'ir' | 'output' | 'artifacts';

export function OutputPanel({ ir, output, outputLanguage, artifacts }: OutputPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('output');

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'output', label: 'Compiled Output' },
    { key: 'ir', label: 'KERN IR' },
    ...(artifacts.length > 0 ? [{ key: 'artifacts' as Tab, label: 'Artifacts', badge: artifacts.length }] : []),
  ];

  const [selectedArtifact, setSelectedArtifact] = useState(0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              color: activeTab === tab.key ? '#e6edf3' : '#8b949e',
              background: activeTab === tab.key ? '#0d1117' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #ff6b6b' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span style={{
                background: '#30363d',
                color: '#8b949e',
                borderRadius: 10,
                padding: '1px 6px',
                fontSize: 11,
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'output' && (
          <PlaygroundEditor
            value={output ?? ''}
            onChange={() => {}}
            language={outputLanguage}
            readOnly
          />
        )}
        {activeTab === 'ir' && (
          <PlaygroundEditor
            value={ir ?? ''}
            onChange={() => {}}
            language="plaintext"
            readOnly
          />
        )}
        {activeTab === 'artifacts' && (
          <div style={{ display: 'flex', height: '100%' }}>
            <div style={{
              width: 200,
              borderRight: '1px solid #30363d',
              overflow: 'auto',
              background: '#161b22',
            }}>
              {artifacts.map((artifact, i) => (
                <button
                  key={artifact.path}
                  onClick={() => setSelectedArtifact(i)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 12,
                    color: selectedArtifact === i ? '#e6edf3' : '#8b949e',
                    background: selectedArtifact === i ? '#0d1117' : 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: "'JetBrains Mono', monospace",
                    borderBottom: '1px solid #21262d',
                  }}
                >
                  {artifact.path}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PlaygroundEditor
                value={artifacts[selectedArtifact]?.content ?? ''}
                onChange={() => {}}
                language={outputLanguage}
                readOnly
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
