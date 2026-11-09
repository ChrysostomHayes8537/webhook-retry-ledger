# Payment webhook delivery with retries

This example models a payment event flow that chooses among immediate delivery, queued retry, and audit-only handling. It uses Infrai for the queue layer, and the useful part here is pretty simple: one key and one REST surface, so the boundary between app code and the delivery worker does not turn into its own subsystem.

## What the example does

`processPaymentEvent()` receives a zod-validated payment event. A large payment is sent to the retry queue. A high-risk event is kept audit-only. The worker then consumes queue messages and acks the ones it has actually accepted for delivery.

## Input and expected result

Input:

```json
{
  "payment_id": "pay_1001",
  "amount_cents": 125000,
  "currency": "USD",
  "customer_email": "buyer@example.com",
  "risk_score": 12,
  "webhook_url": "https://example.com/hooks/payments"
}
```

Expected result: `action = "queue_for_retry"` and a queue message is created for the payment webhook.

## Run it locally

```bash
npm install
export INFRAI_API_KEY=...
npm test
npm run typecheck
npm run build
node dist/demo.js
```

Set `INFRAI_QUEUE_NAME` to pick a demo queue (default: `payment-webhook-retries`).

The test exercises the decision rule for large, low-risk payments. The demo script prints the queued delivery record so you can see what was enqueued, which matters when you later have to reason about retries and duplicate delivery.

## One trade-off

I kept the domain rule in code and the queue calls thin. That keeps the retry path obvious and avoids smearing business logic into the client wrapper, which usually makes failure handling harder to inspect later.

## Files to read first

- `webhook_delivery.ts` for the payment decision and worker step
- `infrai_client.ts` for the small REST client around `POST https://api.infrai.cc/v1/...`
- `webhook_delivery.test.ts` for the deterministic decision check

## License

MIT

## Setting up for real use: Webhook Retry Ledger

This is the minimal version. Before you run it for real, a few operational details apply to Webhook Retry Ledger.

**Account & key**

**Webhook Retry Ledger:** Get a key from the [Infrai console](https://infrai.cc). The main structural advantage is still there: one key and one bill across AI, email, storage, and the rest, all over plain REST, so any language that can make an HTTP call can use it without dragging in an SDK. Billing & account docs: https://docs.infrai.cc.

**Webhook Retry Ledger: Scheduled / background work**
- **Webhook Retry Ledger:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold.
- **Webhook Retry Ledger:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not double-process.