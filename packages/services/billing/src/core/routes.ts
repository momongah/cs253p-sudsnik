import { z } from "zod";
import { IdSchema, IdempotencyHeaders } from "@sudsnik/contracts";
import { PaymentsWebhook } from "@sudsnik/contracts/mocks/payments";
import { Charge, LedgerEntry, LedgerFilter, Quote, routes } from "@sudsnik/contracts/services/billing";
import { sendResult, type App } from "@sudsnik/infra-http";
import type { BillingServiceImpl } from "./BillingService.js";

const OrderParams = z.object({ orderId: IdSchema });

export function registerRoutes(app: App, service: BillingServiceImpl): void {
  app.get(routes.quote.path, { schema: { params: OrderParams, response: { 200: Quote } } }, async (req, reply) => sendResult(reply, await service.quote(req.params.orderId, req.ctx)));
  app.post(routes.authorize.path, { schema: { headers: IdempotencyHeaders, body: routes.authorize.body, response: { 201: Charge } } }, async (req, reply) => sendResult(reply, await service.authorize(req.body.orderId, req.body.amount, req.ctx), 201));
  app.post(routes.capture.path, { schema: { headers: IdempotencyHeaders, params: OrderParams, response: { 200: Charge } } }, async (req, reply) => sendResult(reply, await service.capture(req.params.orderId, req.ctx)));
  app.post(routes.refund.path, { schema: { headers: IdempotencyHeaders, params: OrderParams, response: { 200: Charge } } }, async (req, reply) => sendResult(reply, await service.refund(req.params.orderId, req.ctx)));
  app.get(routes.ledger.path, { schema: { querystring: LedgerFilter, response: { 200: z.array(LedgerEntry) } } }, async (req, reply) => sendResult(reply, await service.ledger(req.query, req.ctx)));
  app.post(routes.paymentsWebhook.path, { schema: { body: PaymentsWebhook, response: { 200: routes.paymentsWebhook.response } } }, async (req, reply) => sendResult(reply, await service.webhook(req.body, req.ctx)));
}
