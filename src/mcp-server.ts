import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createToolDispatcher, toolDefinitions } from './mcp-tools.ts';
import type { Operations } from './mcp-tools.ts';

// The application supplies configured sandbox operations. No approval tool
// or environment-controlled approval bypass is exposed through MCP.
export function createMcpServer(operations: Operations): Server {
  const server = new Server(
    { name: 'paypal-operations-agent', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const dispatch = createToolDispatcher(operations);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map(definition => ({
      ...definition,
      inputSchema: { ...definition.inputSchema, type: 'object' as const },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const result = await dispatch(
        request.params.name, request.params.arguments ?? {},
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }],
      };
    } catch {
      // Do not expose SDK errors, credentials, database paths or raw responses.
      // A failed execution response does not establish whether PayPal sent it.
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: 'Tool request failed. If reminder execution was requested, review the persisted attempt and reconcile any uncertain outcome before retrying.',
        }],
      };
    }
  });
  return server;
}

export async function startStdioMcpServer(operations: Operations): Promise<Server> {
  const server = createMcpServer(operations);
  try {
    await server.connect(new StdioServerTransport());
    return server;
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}
