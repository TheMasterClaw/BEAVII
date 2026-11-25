import { NextRequest, NextResponse } from 'next/server';
import { AGENT_TOOLS, asFunctionSchemas, authenticateAgent } from '@/lib/external-agents';
import { publicRecord } from '@/lib/agent-accounts/store';

export const dynamic = 'force-dynamic';

/** GET /api/agents/v1 — discovery: tools, endpoints and (with a key) which agent account you are. */
export async function GET(req: NextRequest) {
  const ctx = await authenticateAgent(req).catch(() => null);
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    name: 'BEAVII agent gateway',
    version: '1',
    agent: ctx ? publicRecord(ctx.rec) : null,
    auth: 'Authorization: Bearer <agent key>  (or X-API-Key). Create an agent account at /dashboard/agents.',
    model:
      'Each agent has its own wallet. It trades with funds its owner sent it, or with owner funds the owner allowed on-chain ' +
      '(tUSDC allowance to buy, ETF-share allowance to sell, ETF authorization to rebalance). Call get_account first.',
    endpoints: {
      mcp: `${origin}/api/agents/v1/mcp`,
      openapi: `${origin}/api/agents/v1/openapi.json`,
      callTool: `${origin}/api/agents/v1/tools/{name}`,
      dashboard: `${origin}/dashboard/agents`,
    },
    tools: AGENT_TOOLS.map((t) => ({ name: t.name, kind: t.kind, description: t.description, inputSchema: t.inputSchema })),
    functions: asFunctionSchemas(),
  });
}
