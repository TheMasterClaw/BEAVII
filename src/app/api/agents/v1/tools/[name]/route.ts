import { NextRequest, NextResponse } from 'next/server';
import { ToolError, authenticateAgent, callTool } from '@/lib/external-agents';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/agents/v1/tools/:name  body = tool arguments (JSON object, may be empty). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const ctx = await authenticateAgent(req);
    if (!ctx) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const text = await req.text();
    let args: unknown = {};
    if (text.trim()) {
      try {
        args = JSON.parse(text);
      } catch {
        return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 });
      }
    }
    return NextResponse.json({ ok: true, tool: name, result: await callTool(ctx, name, args) });
  } catch (e) {
    const err = e instanceof ToolError ? e : new ToolError((e as Error).message, 500);
    const headers = err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : undefined;
    return NextResponse.json({ ok: false, tool: name, error: err.message }, { status: err.status, headers });
  }
}
