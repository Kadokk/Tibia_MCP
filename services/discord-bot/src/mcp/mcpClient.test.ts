import { describe, expect, it, vi } from 'vitest';
import { McpBridge } from './mcpClient';

describe('McpBridge.callTool', () => {
  it('flattens text content from callTool', async () => {
    const fake = { callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }], isError: false }) };
    const mcp = new McpBridge(fake as never);
    await expect(mcp.callTool('search_wiki', { query: 'x' })).resolves.toEqual({ text: 'hello', isError: false });
  });

  it('joins multiple text blocks with newlines and ignores non-text content', async () => {
    const fake = {
      callTool: vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'image', data: 'base64', mimeType: 'image/png' },
          { type: 'text', text: 'line 2' }
        ],
        isError: false
      })
    };
    const mcp = new McpBridge(fake as never);
    await expect(mcp.callTool('search_item', { name: 'sword' })).resolves.toEqual({ text: 'line 1\nline 2', isError: false });
  });

  it('surfaces isError=true from a failing tool call', async () => {
    const fake = { callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'boom' }], isError: true }) };
    const mcp = new McpBridge(fake as never);
    await expect(mcp.callTool('lookup_character', { name: 'nobody' })).resolves.toEqual({ text: 'boom', isError: true });
  });

  it('passes the tool name and arguments through to the underlying client', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false });
    const mcp = new McpBridge({ callTool } as never);
    await mcp.callTool('search_spell', { query: 'exura' });
    expect(callTool).toHaveBeenCalledWith({ name: 'search_spell', arguments: { query: 'exura' } });
  });
});

describe('McpBridge.listTools', () => {
  it('maps name, description and inputSchema, defaulting a missing description to empty string', async () => {
    const fake = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: 'search_wiki', description: 'Search the wiki', inputSchema: { type: 'object', properties: { query: {} } } },
          { name: 'clear_cache', inputSchema: { type: 'object', properties: {} } }
        ]
      })
    };
    const mcp = new McpBridge(fake as never);
    await expect(mcp.listTools()).resolves.toEqual([
      { name: 'search_wiki', description: 'Search the wiki', inputSchema: { type: 'object', properties: { query: {} } } },
      { name: 'clear_cache', description: '', inputSchema: { type: 'object', properties: {} } }
    ]);
  });
});
