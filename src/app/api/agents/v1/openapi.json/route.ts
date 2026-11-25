import { NextRequest, NextResponse } from 'next/server';
import { AGENT_TOOLS } from '@/lib/external-agents';

export const dynamic = 'force-dynamic';

/** OpenAPI 3.1 spec of the tool endpoints, for Grok / GPT Actions / LangChain / any OpenAPI-driven agent. */
export function GET(req: NextRequest) {
  const paths = Object.fromEntries(
    AGENT_TOOLS.map((t) => [
      `/api/agents/v1/tools/${t.name}`,
      {
        post: {
          operationId: t.name,
          summary: t.name.replace(/_/g, ' '),
          description: t.description,
          'x-kind': t.kind,
          requestBody: { required: false, content: { 'application/json': { schema: t.inputSchema } } },
          responses: {
            '200': {
              description: 'Tool result',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { ok: { type: 'boolean' }, tool: { type: 'string' }, result: {} } },
                },
              },
            },
            '400': { $ref: '#/components/responses/Error' },
            '401': { $ref: '#/components/responses/Error' },
            '403': { $ref: '#/components/responses/Error' },
            '429': { $ref: '#/components/responses/Error' },
          },
        },
      },
    ]),
  );
  return NextResponse.json({
    openapi: '3.1.0',
    info: {
      title: 'BEAVII Agent API',
      version: '1.0.0',
      description:
        'Tools for external AI agents with their own BEAVII accounts (Base Sepolia testnet). Create an agent and its key at /dashboard/agents.',
    },
    servers: [{ url: req.nextUrl.origin }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Agent key from /dashboard/agents' } },
      responses: {
        Error: {
          description: 'Error',
          content: { 'application/json': { schema: { type: 'object', properties: { ok: { const: false }, error: { type: 'string' } } } } },
        },
      },
    },
  });
}
