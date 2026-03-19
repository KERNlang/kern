'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlaygroundEditor } from '@/components/PlaygroundEditor';
import { TargetSelector } from '@/components/TargetSelector';
import { OutputPanel } from '@/components/OutputPanel';
import { StatsBar } from '@/components/StatsBar';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EXAMPLES } from '@/lib/examples';
import { TARGET_LANGUAGE } from '@/lib/targets';
import type { PlaygroundTarget } from '@/lib/targets';
import type { CompileResult } from '@/lib/compile';

export default function PlaygroundPage() {
  const [sourceCode, setSourceCode] = useState(EXAMPLES[0].source);
  const [selectedTarget, setSelectedTarget] = useState<PlaygroundTarget>('tailwind');
  const [irOutput, setIrOutput] = useState<string | null>(null);
  const [compiledOutput, setCompiledOutput] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<CompileResult['artifacts']>([]);
  const [stats, setStats] = useState<CompileResult['stats']>(null);
  const [error, setError] = useState<CompileResult['error']>(null);
  const [isLoading, setIsLoading] = useState(false);

  const doCompile = useCallback(async (source: string, target: PlaygroundTarget) => {
    if (!source.trim()) {
      setIrOutput(null);
      setCompiledOutput(null);
      setArtifacts([]);
      setStats(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, target }),
      });
      const result: CompileResult = await res.json();
      setIrOutput(result.ir);
      setCompiledOutput(result.output);
      setArtifacts(result.artifacts);
      setStats(result.stats);
      setError(result.error);
    } catch {
      setError({ message: 'Failed to reach compile endpoint', line: 0, col: 0, codeFrame: '' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced compile on source/target change
  useEffect(() => {
    const timer = setTimeout(() => {
      doCompile(sourceCode, selectedTarget);
    }, 400);
    return () => clearTimeout(timer);
  }, [sourceCode, selectedTarget, doCompile]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #30363d',
        background: '#161b22',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}>
            <span style={{ color: '#ff6b6b' }}>KERN</span>
            <span style={{ color: '#8b949e', fontWeight: 400, marginLeft: 8 }}>Playground</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 12, color: '#8b949e' }}>Target:</label>
          <TargetSelector value={selectedTarget} onChange={setSelectedTarget} />

          <select
            onChange={(e) => {
              const idx = parseInt(e.target.value, 10);
              if (idx >= 0) {
                const example = EXAMPLES[idx];
                setSourceCode(example.source);
                setSelectedTarget(example.recommendedTarget as PlaygroundTarget);
              }
            }}
            defaultValue=""
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
            <option value="" disabled>Examples</option>
            {EXAMPLES.map((example, i) => (
              <option key={example.name} value={i}>
                {example.name} — {example.description}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main panels */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Source editor */}
        <div style={{
          width: '40%',
          borderRight: '1px solid #30363d',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid #30363d',
            background: '#161b22',
            fontSize: 12,
            fontWeight: 500,
            color: '#8b949e',
          }}>
            Source (.kern)
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <PlaygroundEditor
              value={sourceCode}
              onChange={setSourceCode}
              language="plaintext"
            />
          </div>
        </div>

        {/* Output panels */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}>
          {error ? (
            <ErrorPanel error={error} />
          ) : (
            <OutputPanel
              ir={irOutput}
              output={compiledOutput}
              outputLanguage={TARGET_LANGUAGE[selectedTarget]}
              artifacts={artifacts}
            />
          )}
        </div>
      </div>

      {/* Stats bar */}
      <StatsBar
        stats={stats}
        artifactCount={artifacts.length}
        isLoading={isLoading}
      />
    </div>
  );
}
