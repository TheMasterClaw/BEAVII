import { NextRequest, NextResponse } from 'next/server';
import { AGENT_TOOLS, ToolError, authenticateAgent, callTool } from '@/lib/external-agents';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Stateless MCP server over Streamable HTTP (JSON responses, no sessions/SSE).
 * Point Hermes, OpenClaw, Claude, Cursor or any MCP client at POST /api/agents/v1/mcp with
 * header `Authorization: Bearer <agent key>`.
 */
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

type RpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export async function POST(req: NextRequest) {
  const agent = await authenticateAgent(req).catch(() => null);
  if (!agent) {
    return NextResponse.json(fail(null, -32001, 'unauthorized: send Authorization: Bearer <agent key>'), {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
  }

  let msg: RpcRequest;
  try {
    msg = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, 'parse error'), { status: 400 });
  }
  if (Array.isArray(msg) || msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return NextResponse.json(fail(null, -32600, 'invalid request (batches are not supported)'), { status: 400 });
  }
  // Notifications (no id) get no response body.
  if (msg.id === undefined) return new NextResponse(null, { status: 202 });

  switch (msg.method) {
    case 'initialize': {
      const wanted = String(msg.params?.protocolVersion ?? '');
      return NextResponse.json(
        ok(msg.id, {
          protocolVersion: SUPPORTED.includes(wanted) ? wanted : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'beavii', title: 'BEAVII tokenized stock vaults', version: '1.0.0' },
          instructions:
            'You are an agent with your own wallet on BEAVII (Base Sepolia testnet stock-basket ETFs). Call get_account first: it shows ' +
            'your funds and what your owner allows (spend their tUSDC, sell their ETF shares, rebalance their ETFs). Trades with owner ' +
            'funds deliver results to the owner. Writes send transactions and are rate-limited.',
        }),
      );
    }
    case 'ping':
      return NextResponse.json(ok(msg.id, {}));
    case 'tools/list':
      return NextResponse.json(
        ok(msg.id, {
          tools: AGENT_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: t.kind === 'read', destructiveHint: false, openWorldHint: true },
          })),
        }),
      );
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(agent, name, args);
        return NextResponse.json(
          ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false }),
        );
      } catch (e) {
        const err = e instanceof ToolError ? e : new ToolError((e as Error).message, 500);
        if (err.status === 404) return NextResponse.json(fail(msg.id, -32602, err.message));
        // Tool failures are reported in-band so the model can see and react to them.
        return NextResponse.json(ok(msg.id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }));
      }
    }
    default:
      return NextResponse.json(fail(msg.id, -32601, `method not found: ${msg.method}`));
  }
}

/** No server-initiated stream in stateless mode. */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
