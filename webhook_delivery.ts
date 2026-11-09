import { z } from 'zod';
import { infrai, InfraiError } from './infrai_client.js';

export const PaymentEventSchema = z.object({
  payment_id: z.string().min(1),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3),
  customer_email: z.string().email(),
  risk_score: z.number().min(0).max(100),
  webhook_url: z.string().url()
});

export type PaymentEvent = z.infer<typeof PaymentEventSchema>;

export type DeliveryDecision = {
  action: 'deliver_now' | 'queue_for_retry' | 'audit_only';
  reason: string;
};

export function decideDelivery(event: PaymentEvent): DeliveryDecision {
  if (event.risk_score >= 80) {
    return { action: 'audit_only', reason: 'high risk, keep the webhook off the active path' };
  }

  if (event.amount_cents >= 100000) {
    return { action: 'queue_for_retry', reason: 'large payment, send through the retry queue' };
  }

  return { action: 'deliver_now', reason: 'standard payment event' };
}

export async function processPaymentEvent(input: unknown, queueName = 'payment-webhook-retries') {
  const event = PaymentEventSchema.parse(input);
  const decision = decideDelivery(event);
  const audit = {
    payment_id: event.payment_id,
    risk_score: event.risk_score,
    action: decision.action,
    reason: decision.reason
  };

  if (decision.action === 'audit_only') {
    return { decision, audit, queued: null };
  }

  const queue = await infrai.queue.create({ name: queueName });
  const published = await infrai.queue.publish({
    queue: queueName,
    payload: {
      queue_id: queue.queue_id,
      payment_id: event.payment_id,
      webhook_url: event.webhook_url,
      amount_cents: event.amount_cents,
      currency: event.currency,
      customer_email: event.customer_email,
      risk_score: event.risk_score,
      retry_count: 0
    }
  });

  return { decision, audit, queued: { queue_id: queue.queue_id, message_id: published.message_id } };
}

export async function runWorkerOnce(queueName = 'payment-webhook-retries') {
  const batch = await infrai.queue.consume({ queue: queueName, max_messages: 5, visibility_timeout: 30 });
  const results: Array<{ message_id: string; status: 'acked' | 'held' }> = [];

  for (const message of batch.messages) {
    const payload = message.payload as {
      payment_id: string;
      webhook_url: string;
      retry_count: number;
      risk_score: number;
    };

    if (payload.risk_score >= 80) {
      results.push({ message_id: message.message_id, status: 'held' });
      continue;
    }

    if (payload.retry_count >= 3) {
      results.push({ message_id: message.message_id, status: 'held' });
      continue;
    }

    await infrai.queue.ack({ queue: queueName, message_id: message.message_id });
    results.push({ message_id: message.message_id, status: 'acked' });
  }

  return results;
}

export function describeInfraiError(error: unknown) {
  if (error instanceof InfraiError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'UNKNOWN', message: 'Unexpected error' };
}
