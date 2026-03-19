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

// ── URL Sharing Helpers ──────────────────────────────────────────────────

function encodeSource(source: string): string {
  return btoa(unescape(encodeURIComponent(source)));
}

function decodeSource(encoded: string): string {
  return decodeURIComponent(escape(atob(encoded)));
}

function readShareParams(): { source?: string; target?: PlaygroundTarget } {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const source64 = params.get('source');
  const target = params.get('target') as PlaygroundTarget | null;
  try {
    return {
      source: source64 ? decodeSource(source64) : undefined,
      target: target || undefined,
    };
  } catch {
    return {};
  }
}

function updateShareUrl(source: string, target: string) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('source', encodeSource(source));
    url.searchParams.set('target', target);
    history.replaceState(null, '', url.toString());
  } catch {
    // Skip URL update for oversized source or encoding errors
  }
}

// ── Mobile Detection Hook ────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

// ── Share Button ─────────────────────────────────────────────────────────

function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <button
      onClick={handleShare}
      style={{
        background: copied ? '#238636' : '#21262d',
        color: '#e6edf3',
        border: '1px solid #30363d',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 13,
        fontFamily: 'inherit',
        cursor: 'pointer',
        outline: 'none',
        transition: 'background 0.2s',
      }}
    >
      {copied ? 'Copied!' : 'Share'}
    </button>
  );
}

// ── Mobile Tab Toggle ────────────────────────────────────────────────────

function MobileTabToggle({ active, onChange }: { active: 'editor' | 'output'; onChange: (tab: 'editor' | 'output') => void }) {
  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 600,
    background: isActive ? '#21262d' : 'transparent',
    color: isActive ? '#e6edf3' : '#8b949e',
    border: 'none',
    borderBottom: isActive ? '2px solid #ff6b6b' : '2px solid transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0 }}>
      <button style={tabStyle(active === 'editor')} onClick={() => onChange('editor')}>Editor</button>
      <button style={tabStyle(active === 'output')} onClick={() => onChange('output')}>Output</button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  // Load initial state from URL params or defaults
  const [sourceCode, setSourceCode] = useState(EXAMPLES[0].source);
  const [selectedTarget, setSelectedTarget] = useState<PlaygroundTarget>('tailwind');
  const [irOutput, setIrOutput] = useState<string | null>(null);
  const [compiledOutput, setCompiledOutput] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<CompileResult['artifacts']>([]);
  const [stats, setStats] = useState<CompileResult['stats']>(null);
  const [error, setError] = useState<CompileResult['error']>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<'editor' | 'output'>('editor');
  const isMobile = useIsMobile();

  // Initialize from URL params on mount
  useEffect(() => {
    const shared = readShareParams();
    if (shared.source) setSourceCode(shared.source);
    if (shared.target) setSelectedTarget(shared.target);
  }, []);

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

  // Update share URL after compile
  useEffect(() => {
    updateShareUrl(sourceCode, selectedTarget);
  }, [sourceCode, selectedTarget]);

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
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        gap: isMobile ? 8 : 0,
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#8b949e' }}>Target:</label>
          <TargetSelector value={selectedTarget} onChange={setSelectedTarget} />

          {!isMobile && (
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
          )}

          <ShareButton />
        </div>
      </header>

      {/* Mobile tab toggle */}
      {isMobile && (
        <MobileTabToggle active={mobileTab} onChange={setMobileTab} />
      )}

      {/* Main panels */}
      {isMobile ? (
        // Mobile: stacked layout with tab toggle
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {mobileTab === 'editor' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{
                padding: '8px 16px',
                borderBottom: '1px solid #30363d',
                background: '#161b22',
                fontSize: 12,
                fontWeight: 500,
                color: '#8b949e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span>Source (.kern)</span>
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
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <option value="" disabled>Examples</option>
                  {EXAMPLES.map((example, i) => (
                    <option key={example.name} value={i}>{example.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <PlaygroundEditor
                  value={sourceCode}
                  onChange={setSourceCode}
                  language="kern"
                  error={error}
                />
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
          )}
        </div>
      ) : (
        // Desktop: side-by-side 40/60 split
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
                language="kern"
                error={error}
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
      )}

      {/* Stats bar */}
      <StatsBar
        stats={stats}
        artifactCount={artifacts.length}
        isLoading={isLoading}
      />
    </div>
  );
}
