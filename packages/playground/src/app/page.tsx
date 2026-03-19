'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlaygroundEditor } from '@/components/PlaygroundEditor';
import { TargetSelector } from '@/components/TargetSelector';
import { OutputPanel } from '@/components/OutputPanel';
import { StatsBar } from '@/components/StatsBar';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EXAMPLES } from '@/lib/examples';
import { TARGET_LANGUAGE, TARGET_LABELS } from '@/lib/targets';
import type { PlaygroundTarget } from '@/lib/targets';
import type { CompileResult } from '@/lib/compile';
import type { InferResult } from '@/lib/infer';
import { INFER_EXAMPLES } from '@/lib/infer-examples';

// ── Types ────────────────────────────────────────────────────────────────

type PlaygroundMode = 'compile' | 'infer';

// ── URL Sharing Helpers ──────────────────────────────────────────────────

function encodeSource(source: string): string {
  return btoa(unescape(encodeURIComponent(source)));
}

function decodeSource(encoded: string): string {
  return decodeURIComponent(escape(atob(encoded)));
}

function readShareParams(): { source?: string; target?: PlaygroundTarget; mode?: PlaygroundMode } {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const source64 = params.get('source');
  const target = params.get('target') as PlaygroundTarget | null;
  const mode = params.get('mode') as PlaygroundMode | null;
  try {
    return {
      source: source64 ? decodeSource(source64) : undefined,
      target: target || undefined,
      mode: mode === 'infer' ? 'infer' : undefined,
    };
  } catch {
    return {};
  }
}

function updateShareUrl(source: string, target: string, mode: PlaygroundMode) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('source', encodeSource(source));
    url.searchParams.set('target', target);
    url.searchParams.set('mode', mode);
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

// ── Mode Toggle ──────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange, targetLabel }: { mode: PlaygroundMode; onChange: (m: PlaygroundMode) => void; targetLabel: string }) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    border: '1px solid #30363d',
    cursor: 'pointer',
    outline: 'none',
    transition: 'background 0.15s',
    color: active ? '#e6edf3' : '#8b949e',
    background: active ? '#30363d' : 'transparent',
  });

  return (
    <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden' }}>
      <button style={{ ...btnStyle(mode === 'infer'), borderRadius: '6px 0 0 6px' }} onClick={() => onChange('infer')}>
        {targetLabel} → KERN
      </button>
      <button style={{ ...btnStyle(mode === 'compile'), borderRadius: '0 6px 6px 0', borderLeft: 'none' }} onClick={() => onChange('compile')}>
        KERN → {targetLabel}
      </button>
    </div>
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
      <button style={tabStyle(active === 'editor')} onClick={() => onChange('editor')}>Input</button>
      <button style={tabStyle(active === 'output')} onClick={() => onChange('output')}>Output</button>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function PlaygroundPage() {
  const [mode, setMode] = useState<PlaygroundMode>('infer');
  const [sourceCode, setSourceCode] = useState(INFER_EXAMPLES['tailwind']);
  const [selectedTarget, setSelectedTarget] = useState<PlaygroundTarget>('tailwind');

  // Compile mode state
  const [irOutput, setIrOutput] = useState<string | null>(null);
  const [compiledOutput, setCompiledOutput] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<CompileResult['artifacts']>([]);
  const [stats, setStats] = useState<CompileResult['stats']>(null);
  const [error, setError] = useState<CompileResult['error']>(null);

  // Infer mode state
  const [inferredKern, setInferredKern] = useState<string | null>(null);
  const [inferStats, setInferStats] = useState<InferResult['stats']>(null);
  const [inferError, setInferError] = useState<InferResult['error']>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<'editor' | 'output'>('editor');
  const isMobile = useIsMobile();

  // Initialize from URL params on mount
  useEffect(() => {
    const shared = readShareParams();
    if (shared.mode) setMode(shared.mode);
    if (shared.source) setSourceCode(shared.source);
    else if (shared.mode !== 'infer') setSourceCode(EXAMPLES[0].source);
    if (shared.target) setSelectedTarget(shared.target);
  }, []);

  // Switch mode: swap default source
  const handleModeChange = useCallback((newMode: PlaygroundMode) => {
    setMode(newMode);
    if (newMode === 'infer') {
      setSourceCode(INFER_EXAMPLES[selectedTarget]);
    } else {
      setSourceCode(EXAMPLES[0].source);
    }
    // Clear both states
    setIrOutput(null);
    setCompiledOutput(null);
    setArtifacts([]);
    setStats(null);
    setError(null);
    setInferredKern(null);
    setInferStats(null);
    setInferError(null);
  }, [selectedTarget]);

  // Switch target: load matching example in infer mode
  const handleTargetChange = useCallback((target: PlaygroundTarget) => {
    setSelectedTarget(target);
    if (mode === 'infer') {
      setSourceCode(INFER_EXAMPLES[target]);
    }
  }, [mode]);

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

  const doInfer = useCallback(async (source: string) => {
    if (!source.trim()) {
      setInferredKern(null);
      setInferStats(null);
      setInferError(null);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, language: 'typescript' }),
      });
      const result: InferResult = await res.json();
      setInferredKern(result.kern);
      setInferStats(result.stats);
      setInferError(result.error);
    } catch {
      setInferError({ message: 'Failed to reach infer endpoint', line: 0, col: 0, codeFrame: '' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced action on source/target/mode change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === 'compile') {
        doCompile(sourceCode, selectedTarget);
      } else {
        doInfer(sourceCode);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [sourceCode, selectedTarget, mode, doCompile, doInfer]);

  // Update share URL
  useEffect(() => {
    updateShareUrl(sourceCode, selectedTarget, mode);
  }, [sourceCode, selectedTarget, mode]);

  // Derived: which error/stats to show
  const activeError = mode === 'compile' ? error : inferError;
  const activeStats = mode === 'compile'
    ? stats
    : inferStats
      ? { irTokens: inferStats.kernTokens, outputTokens: inferStats.inputTokens, reduction: -inferStats.reduction }
      : null;

  // Derived labels
  const targetLabel = TARGET_LABELS[selectedTarget];
  const leftLabel = mode === 'compile' ? 'Source (.kern)' : `Input (${targetLabel})`;
  const leftLanguage = mode === 'compile' ? 'kern' : TARGET_LANGUAGE[selectedTarget];

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
          <ModeToggle mode={mode} onChange={handleModeChange} targetLabel={targetLabel} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#8b949e' }}>{mode === 'compile' ? 'Target:' : 'Source:'}</label>
          <TargetSelector value={selectedTarget} onChange={handleTargetChange} />

          {mode === 'compile' && !isMobile && (
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
              }}>
                {leftLabel}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <PlaygroundEditor
                  value={sourceCode}
                  onChange={setSourceCode}
                  language={leftLanguage}
                  error={activeError}
                />
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {mode === 'infer' ? (
                inferError ? (
                  <ErrorPanel error={inferError} />
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{
                      padding: '8px 16px',
                      borderBottom: '1px solid #30363d',
                      background: '#161b22',
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#8b949e',
                    }}>
                      Inferred KERN
                      {inferStats && <span style={{ marginLeft: 8, color: '#4ecdc4' }}>({inferStats.constructs} constructs)</span>}
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                      <PlaygroundEditor
                        value={inferredKern ?? '// Paste TypeScript or React code on the left'}
                        onChange={() => {}}
                        language="kern"
                        readOnly
                      />
                    </div>
                  </div>
                )
              ) : (
                activeError ? (
                  <ErrorPanel error={activeError} />
                ) : (
                  <OutputPanel
                    ir={irOutput}
                    output={compiledOutput}
                    outputLanguage={TARGET_LANGUAGE[selectedTarget]}
                    artifacts={artifacts}
                  />
                )
              )}
            </div>
          )}
        </div>
      ) : (
        // Desktop: side-by-side 40/60 split
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left: input editor */}
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
              {leftLabel}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PlaygroundEditor
                value={sourceCode}
                onChange={setSourceCode}
                language={leftLanguage}
                error={activeError}
              />
            </div>
          </div>

          {/* Right: output */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}>
            {mode === 'infer' ? (
              inferError ? (
                <ErrorPanel error={inferError} />
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{
                    padding: '8px 16px',
                    borderBottom: '1px solid #30363d',
                    background: '#161b22',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#8b949e',
                  }}>
                    Inferred KERN
                    {inferStats && <span style={{ marginLeft: 8, color: '#4ecdc4' }}>({inferStats.constructs} constructs)</span>}
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <PlaygroundEditor
                      value={inferredKern ?? '// Paste TypeScript or React code on the left'}
                      onChange={() => {}}
                      language="kern"
                      readOnly
                    />
                  </div>
                </div>
              )
            ) : (
              activeError ? (
                <ErrorPanel error={activeError} />
              ) : (
                <OutputPanel
                  ir={irOutput}
                  output={compiledOutput}
                  outputLanguage={TARGET_LANGUAGE[selectedTarget]}
                  artifacts={artifacts}
                />
              )
            )}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <StatsBar
        stats={activeStats}
        artifactCount={mode === 'compile' ? artifacts.length : 0}
        isLoading={isLoading}
      />
    </div>
  );
}
