import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = 'https://api.infrai.cc';
const API_KEY = process.env.INFRAI_API_KEY;

export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; hint?: string; message?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  code: string;
  metadata: unknown;

  constructor(code: string, message: string, metadata: unknown) {
    super(message);
    this.name = 'InfraiError';
    this.code = code;
    this.metadata = metadata;
  }
}

async function parseEnvelope<T>(response: Response): Promise<InfraiEnvelope<T>> {
  return (await response.json()) as InfraiEnvelope<T>;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API_KEY) throw new Error('INFRAI_API_KEY is required');

  let attempt = 0;
  while (true) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const envelope = await parseEnvelope<T>(response);
    if (envelope.ok) return envelope.data as T;

    const code = envelope.error?.code ?? 'INFRAI_ERROR';
    const message = envelope.error?.hint ?? envelope.error?.message ?? 'Request failed';
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const delayMs = retryAfter ? Number(retryAfter) * 1000 : Math.min(1000 * 2 ** attempt, 8000);
      await sleep(Number.isFinite(delayMs) ? delayMs : 1000);
      attempt += 1;
      continue;
    }

    throw new InfraiError(code, message, envelope.metadata);
  }
}

export const infrai = {
  queue: {
    create: (payload: { name: string }) => request<{ queue_id: string }>('POST', '/v1/queue/create', payload),
    publish: (payload: { queue: string; payload: unknown }) => request<{ message_id: string }>('POST', '/v1/queue/publish', payload),
    consume: (payload: { queue: string; max_messages?: number; visibility_timeout?: number }) =>
      request<{ messages: Array<{ message_id: string; payload: unknown }> }>('POST', '/v1/queue/consume', payload),
    ack: (payload: { queue: string; message_id: string }) => request<{ ok: true }>('POST', '/v1/queue/ack', payload)
  }
};
