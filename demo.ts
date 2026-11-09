import { processPaymentEvent } from './webhook_delivery.js';

async function main() {
  const result = await processPaymentEvent({
    payment_id: 'pay_1001',
    amount_cents: 125000,
    currency: 'USD',
    customer_email: 'buyer@example.com',
    risk_score: 12,
    webhook_url: 'https://example.com/hooks/payments'
  }, process.env.INFRAI_QUEUE_NAME);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
