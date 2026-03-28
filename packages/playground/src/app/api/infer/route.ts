import { NextResponse } from 'next/server';
import { inferFromSource } from '@/lib/infer';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source, language } = body as { source?: string; language?: string };

    if (!source || typeof source !== 'string') {
      return NextResponse.json(
        { error: { message: 'Missing "source" field', line: 0, col: 0, codeFrame: '' }, kern: null, findings: [], stats: null },
        { status: 400 },
      );
    }

    const result = inferFromSource(source, language ?? 'typescript');
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: { message: 'Internal server error', line: 0, col: 0, codeFrame: '' }, kern: null, findings: [], stats: null },
      { status: 500 },
    );
  }
}
