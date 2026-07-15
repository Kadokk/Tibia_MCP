import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export type McpToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };
export type McpToolResult = { text: string; isError: boolean };

type CallableClient = Pick<Client, 'callTool' | 'listTools'>;

export class McpBridge {
  constructor(private readonly client: CallableClient) {}

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.client.listTools();
    return res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const res = await this.client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    return { text, isError: res.isError === true };
  }
}

export async function connectMcp(command: string, cwd?: string): Promise<McpBridge> {
  const transport = new StdioClientTransport({ command, args: [], cwd });
  const client = new Client({ name: 'tibiaedge-bot', version: '0.1.0' });
  await client.connect(transport);
  return new McpBridge(client);
}
