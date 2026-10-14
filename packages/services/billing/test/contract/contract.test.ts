import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@sudsnik/contracts/services/billing";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import { createApp, handlersDir } from "../../src/index.js";
import { ok } from "@sudsnik/kernel";

contractSuite(
  { describe, it, expect, beforeAll, afterAll },
  {
    service: "billing",
    routes,
    createApp,
    handlersDir,
    prepare(deps) {
      deps.clients.payments.authorize = async (request) => ok({ paymentRef: `pay-${request.orderId}`, state: "authorized", amount: request.amount, currency: request.currency });
      deps.clients.payments.capture = async (paymentRef, amount) => ok({ paymentRef, state: "captured", amount: amount ?? 1, currency: "USD" });
      deps.clients.payments.refund = async (paymentRef, amount) => ok({ paymentRef, state: "refunded", amount: amount ?? 1, currency: "USD" });
    },
    examples: {
      quote: { params: { orderId: "o1" } },
      authorize: { body: { orderId: "o1", amount: 1 } },
      capture: { params: { orderId: "o1" } },
      refund: { params: { orderId: "o1" } },
      ledger: { query: { limit: "10" } },
      paymentsWebhook: { body: { id: "wh1", paymentRef: "pay1", orderId: "o1", event: "captured", amount: 1, currency: "USD", atMs: 0 } },
    },
  },
);
