import test from 'node:test';
import assert from 'node:assert/strict';
// Set a dummy key before loading the client; all network calls in this file are mocked.
process.env.INFRAI_API_KEY ??= 'local-test-key';
const { decideDelivery } = await import('./webhook_delivery.js');

test('large low-risk payments go to the retry queue', () => {
  const decision = decideDelivery({
    payment_id: 'pay_1',
    amount_cents: 150000,
    currency: 'USD',
    customer_email: 'customer@example.com',
    risk_score: 10,
    webhook_url: 'https://example.com/hooks/payments'
  });

  assert.equal(decision.action, 'queue_for_retry');
  assert.equal(decision.reason, 'large payment, send through the retry queue');
});

test('high risk events stay on the audit path', () => {
  const decision = decideDelivery({
    payment_id: 'pay_2',
    amount_cents: 5000,
    currency: 'USD',
    customer_email: 'customer@example.com',
    risk_score: 92,
    webhook_url: 'https://example.com/hooks/payments'
  });

  assert.equal(decision.action, 'audit_only');
});

test('queue operations send the required queue identifier', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.INFRAI_API_KEY;
  process.env.INFRAI_API_KEY ??= 'local-test-key';
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    const data = path.endsWith('/create') ? { queue_id: 'queue-id' }
      : path.endsWith('/publish') ? { message_id: 'message-id' }
      : path.endsWith('/consume') ? { messages: [{ message_id: 'message-id', payload: { risk_score: 10, retry_count: 0 } }] }
      : { ok: true };
    return new Response(JSON.stringify({ ok: true, data }));
  };
  try {
    const { processPaymentEvent, runWorkerOnce } = await import('./webhook_delivery.js');
    await processPaymentEvent({
      payment_id: 'pay_contract', amount_cents: 150000, currency: 'USD',
      customer_email: 'customer@example.com', risk_score: 10,
      webhook_url: 'https://example.com/hooks/payments'
    }, 'contract-queue');
    assert.deepEqual(await runWorkerOnce('contract-queue'), [{ message_id: 'message-id', status: 'acked' }]);
    assert.deepEqual(calls.map(call => call.path), [
      '/v1/queue/create', '/v1/queue/publish', '/v1/queue/consume', '/v1/queue/ack'
    ]);
    assert.equal(calls[0].body.name, 'contract-queue');
    for (const call of calls.slice(1)) assert.equal(call.body.queue, 'contract-queue');
    assert.ok(calls[1].body.payload);
    assert.equal(calls[3].body.message_id, 'message-id');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.INFRAI_API_KEY;
    else process.env.INFRAI_API_KEY = originalKey;
  }
});
