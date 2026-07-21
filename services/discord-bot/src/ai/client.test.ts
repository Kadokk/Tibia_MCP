import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { createAiClient, describeAiError } from './client';

type FetchSeam = { fetch: (url: unknown, init?: { headers?: HeadersInit }) => Promise<Response> };

/** Captures the headers of the one request the client is about to make. */
async function captureRequestHeaders(client: OpenAI): Promise<Headers> {
  let sent: Headers | undefined;
  // `fetch` is private in the SDK's types, but stubbing it is the only seam that
  // reveals the headers actually put on the wire.
  (client as unknown as FetchSeam).fetch = async (_url, init): Promise<Response> => {
    sent = new Headers(init?.headers);
    return new Response(JSON.stringify({ id: 'x', choices: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await client.chat.completions.create({ model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });
  if (!sent) throw new Error('no request was made');
  return sent;
}

describe('createAiClient', () => {
  it('points at the OpenRouter API', () => {
    expect(createAiClient('sk-test').baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('defaults the timeout to 60s', () => {
    expect(createAiClient('sk-test').timeout).toBe(60_000);
  });

  it('honours a timeout override', () => {
    expect(createAiClient('sk-test', { timeout: 30_000 }).timeout).toBe(30_000);
  });

  it('retries twice', () => {
    expect(createAiClient('sk-test').maxRetries).toBe(2);
  });

  // X-Title identifies the app on OpenRouter; HTTP-Referer would leak our hostname.
  it('sends X-Title and no referer header', async () => {
    const headers = await captureRequestHeaders(createAiClient('sk-test'));
    expect(headers.get('x-title')).toBe('TibiaEdge');
    expect(headers.get('http-referer')).toBeNull();
    expect(headers.get('referer')).toBeNull();
  });
});

describe('describeAiError', () => {
  it('reports status and message without leaking response headers', () => {
    const err = new OpenAI.APIError(
      401,
      { error: { message: 'No auth credentials found' } },
      undefined,
      new Headers({ authorization: 'Bearer sk-or-v1-SUPERSECRET', 'x-request-id': 'req_123' })
    );

    const described = describeAiError(err);

    expect(described).toContain('401');
    expect(described).toContain(err.message);
    expect(described).not.toContain('SUPERSECRET');
    expect(described).not.toContain('Bearer');
    expect(described.toLowerCase()).not.toContain('authorization');
    expect(described).not.toContain('req_123');
  });

  it('describes a plain Error by its message', () => {
    expect(describeAiError(new Error('socket hang up'))).toContain('socket hang up');
  });

  it('describes a non-Error throwable', () => {
    expect(describeAiError('boom')).toContain('boom');
  });
});
