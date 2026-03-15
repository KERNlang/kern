'use client';

import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="bg-zinc-950">
      <div className="justify-between items-center p-4 [border:#27272a] flex">
        <Link href="/">
          <h1 className="text-2xl font-bold text-white">AudioFacets</h1>
        </Link>
        <div className="gap-4 items-center flex">
          <Link href="/features">
            <span className="text-sm text-zinc-400">Features</span>
          </Link>
          <Link href="/pricing">
            <span className="text-sm text-zinc-400">Pricing</span>
          </Link>
          <Link href="/signup" className="bg-orange-500 text-white rounded-lg p-3 [transition:all_0.2s_ease]">Get Started</Link>
        </div>
      </div>
      <div className="items-center p-[80px] gap-6 flex flex-col">
        <h1 className="text-[48px] font-extrabold text-white [text-align:center]">Analyze your mix in seconds</h1>
        <p className="text-lg text-zinc-400 [text-align:center]">AI-powered stem separation, frequency analysis, and mastering suggestions.</p>
        <div className="gap-4 flex">
          <Link href="/signup" className="bg-orange-500 text-white rounded-lg p-4 text-base font-semibold">Start Free Trial</Link>
          <button className="bg-[transparent] text-white rounded-lg p-4 text-base font-semibold [border:#3f3f46]" onClick={openDemo}>Watch Demo</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
          <span className="text-lg font-semibold text-white mb-2">Stem Separation</span>
          <p className="text-sm text-zinc-400">Split any track into drums, bass, vocals, and more using Demucs ML.</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
          <span className="text-lg font-semibold text-white mb-2">Frequency Analysis</span>
          <p className="text-sm text-zinc-400">Identify problematic frequencies and get EQ fix suggestions per stem.</p>
        </div>
        <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
          <span className="text-lg font-semibold text-white mb-2">Mastering Chain</span>
          <p className="text-sm text-zinc-400">Auto-generated mastering presets based on your genre and reference tracks.</p>
        </div>
      </div>
      <div className="justify-center p-8 [border:#27272a] flex">
        <span className="text-xs text-zinc-500">© 2026 AudioFacets. Built with LLM-Speach.</span>
      </div>
    </div>
  );
}