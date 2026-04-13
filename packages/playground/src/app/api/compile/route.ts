import type { KernTarget } from '@kernlang/core';
import { VALID_TARGETS } from '@kernlang/core';
import { NextResponse } from 'next/server';
import { compile } from '@/lib/compile';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source, target } = body as { source?: string; target?: string };

    if (!source || typeof source !== 'string') {
      return NextResponse.json(
        {
          error: { message: 'Missing "source" field', line: 0, col: 0, codeFrame: '' },
          ir: null,
          output: null,
          artifacts: [],
          stats: null,
        },
        { status: 400 },
      );
    }

    if (!target || !VALID_TARGETS.includes(target as KernTarget)) {
      return NextResponse.json(
        {
          error: { message: `Invalid target. Valid: ${VALID_TARGETS.join(', ')}`, line: 0, col: 0, codeFrame: '' },
          ir: null,
          output: null,
          artifacts: [],
          stats: null,
        },
        { status: 400 },
      );
    }

    const result = compile(source, target as KernTarget);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        error: { message: 'Internal server error', line: 0, col: 0, codeFrame: '' },
        ir: null,
        output: null,
        artifacts: [],
        stats: null,
      },
      { status: 500 },
    );
  }
}
