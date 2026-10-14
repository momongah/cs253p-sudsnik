import {
  CYCLE_UNIT_PRICE_MINOR,
  DEFAULT_CURRENCY,
  EXPECTED_CYCLE_UNITS,
  makeEnvelope,
  parsePayload,
  WASH_PRICE_MINOR,
  type Ctx,
  type Envelope,
  type ServiceDeps,
} from "@sudsnik/contracts";
import type { PaymentsWebhook } from "@sudsnik/contracts/mocks/payments";
import type { Charge, LedgerEntry, LedgerFilter, Quote } from "@sudsnik/contracts/services/billing";
import type { Db } from "@sudsnik/infra-db";
import type { Outbox } from "@sudsnik/infra-queue";
import { err, newId, ok, sudsnikError, type Result } from "@sudsnik/kernel";

export class BillingServiceImpl {
  private readonly currencies = new Map<string, "USD" | "EUR" | "AUD">();
  private readonly tiers = new Map<string, "standard" | "priority">();

  constructor(private readonly db: Db, private readonly outbox: Outbox, private readonly deps: ServiceDeps) {}

  async quote(orderId: string, ctx: Ctx): Promise<Result<Quote>> {
    const order = await this.deps.clients.orders.get(orderId, ctx);
    if (!order.ok) return order;
    const tier = this.tiers.get(ctx.tenantId) ?? "standard";
    const currency = this.currencies.get(ctx.tenantId) ?? DEFAULT_CURRENCY;
    const usdAmount = WASH_PRICE_MINOR[tier] + EXPECTED_CYCLE_UNITS * CYCLE_UNIT_PRICE_MINOR;
    const amount = currency === "USD" ? usdAmount : Math.round((usdAmount * ({ EUR: 9_200, AUD: 15_200 } as const)[currency]) / 10_000);
    return ok({ orderId: order.value.orderId, amount, currency, breakdown: { base: WASH_PRICE_MINOR[tier], cycleUnits: EXPECTED_CYCLE_UNITS, tier } });
  }

  async authorize(orderId: string, amount: number, ctx: Ctx): Promise<Result<Charge>> {
    const existing = this.findCharge(ctx.tenantId, orderId);
    if (existing) return ok(existing);
    const currency = this.currencies.get(ctx.tenantId) ?? DEFAULT_CURRENCY;
    const payment = await this.deps.clients.payments.authorize({
      orderId, amount, currency, callbackUrl: `${this.deps.env.SUDSNIK_BILLING_URL ?? ""}/callbacks`,
    }, ctx);
    if (!payment.ok) return payment;
    const charge: Charge = { chargeId: newId(), tenantId: ctx.tenantId, orderId, amount, currency, state: "authorized", paymentRef: payment.value.paymentRef, updatedAt: this.deps.clock.now() };
    this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare("insert into charges (charge_id, tenant_id, order_id, amount, currency, state, payment_ref, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(charge.chargeId, charge.tenantId, charge.orderId, charge.amount, charge.currency, charge.state, charge.paymentRef, charge.updatedAt);
      this.addLedger(charge, "authorize", amount);
    })();
    return ok(charge);
  }

  async capture(orderId: string, ctx: Ctx): Promise<Result<Charge>> {
    return this.changeState(orderId, ctx, "captured", "capture");
  }

  async refund(orderId: string, ctx: Ctx): Promise<Result<Charge>> {
    return this.changeState(orderId, ctx, "refunded", "refund");
  }

  async ledger(filter: LedgerFilter, ctx: Ctx): Promise<Result<LedgerEntry[]>> {
    const query = filter.orderId
      ? this.db.sqlite.prepare("select * from ledger where tenant_id = ? and order_id = ? order by entry_id limit ?").all(ctx.tenantId, filter.orderId, filter.limit)
      : this.db.sqlite.prepare("select * from ledger where tenant_id = ? order by entry_id limit ?").all(ctx.tenantId, filter.limit);
    return ok((query as Array<Record<string, unknown>>).map((row) => ({
      entryId: String(row.entry_id), tenantId: String(row.tenant_id), orderId: String(row.order_id),
      kind: row.kind as LedgerEntry["kind"], amount: Number(row.amount), currency: String(row.currency),
      at: Number(row.at), ...(row.ref === null ? {} : { ref: String(row.ref) }),
    })));
  }

  async webhook(webhook: PaymentsWebhook, ctx: Ctx): Promise<Result<{ accepted: boolean; duplicate: boolean }>> {
    const result = this.db.sqlite.transaction(() => {
      const claimed = this.db.sqlite.prepare("insert or ignore into webhook_dedupe (webhook_id, tenant_id, received_at) values (?, ?, ?)").run(webhook.id, ctx.tenantId, this.deps.clock.now()).changes === 1;
      if (!claimed) return { accepted: true, duplicate: true };
      const charge = this.findCharge(ctx.tenantId, webhook.orderId);
      if (!charge) return { accepted: true, duplicate: false };
      const state: Charge["state"] = webhook.event === "captured" ? "captured" : webhook.event === "refunded" ? "refunded" : "failed";
      const updated = { ...charge, state, paymentRef: webhook.paymentRef, amount: webhook.amount, currency: webhook.currency, updatedAt: webhook.atMs };
      this.db.sqlite.prepare("update charges set state = ?, payment_ref = ?, amount = ?, currency = ?, updated_at = ? where charge_id = ?").run(updated.state, updated.paymentRef, updated.amount, updated.currency, updated.updatedAt, updated.chargeId);
      if (webhook.event !== "failed") this.addLedger(updated, webhook.event === "captured" ? "capture" : "refund", webhook.amount);
      const topic = webhook.event === "captured" ? "charge.captured" : webhook.event === "refunded" ? "refund.issued" : "charge.failed";
      const payload = webhook.event === "failed"
        ? { orderId: webhook.orderId, chargeId: charge.chargeId, reason: "payments webhook failed" }
        : { orderId: webhook.orderId, chargeId: charge.chargeId, amount: webhook.amount, currency: webhook.currency };
      this.outbox.enqueue(makeEnvelope({ topic, tenantId: ctx.tenantId, occurredAt: webhook.atMs, correlationId: ctx.correlationId, causationId: webhook.id, payload }));
      return { accepted: true, duplicate: false };
    })();
    return ok(result);
  }

  async applyEvent(envelope: Envelope): Promise<Result<void>> {
    try {
      const claimed = this.db.sqlite.prepare("insert or ignore into consumed (envelope_id, topic, at) values (?, ?, ?)").run(envelope.id, envelope.topic, envelope.occurredAt).changes === 1;
      if (!claimed) return ok(undefined);
      if (envelope.topic === "operator.updated") {
        const payload = parsePayload("operator.updated", envelope.payload);
        this.tiers.set(payload.operatorId, payload.pricingTier);
        this.currencies.set(payload.operatorId, payload.currency);
      } else if (envelope.topic === "order.returned") {
        const payload = parsePayload("order.returned", envelope.payload);
        const result = await this.capture(payload.orderId, { tenantId: envelope.tenantId, correlationId: envelope.correlationId });
        if (!result.ok && result.error.code !== "NOT_FOUND") return result;
      } else if (envelope.topic === "wash.completed") {
        parsePayload("wash.completed", envelope.payload);
      }
      return ok(undefined);
    } catch (cause) {
      return err(sudsnikError("INTERNAL", `billing failed to apply ${envelope.topic}`, cause));
    }
  }

  private async changeState(orderId: string, ctx: Ctx, state: "captured" | "refunded", kind: "capture" | "refund"): Promise<Result<Charge>> {
    const charge = this.findCharge(ctx.tenantId, orderId);
    if (!charge) return err(sudsnikError("NOT_FOUND", `charge for order ${orderId} was not found`));
    if (charge.state === state) return ok(charge);
    if (!charge.paymentRef) return err(sudsnikError("CONFLICT", `charge for order ${orderId} has no payment reference`));
    const payment = state === "captured"
      ? await this.deps.clients.payments.capture(charge.paymentRef, charge.amount, ctx)
      : await this.deps.clients.payments.refund(charge.paymentRef, charge.amount, ctx);
    if (!payment.ok) return payment;
    const updated = { ...charge, state, updatedAt: this.deps.clock.now() };
    this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare("update charges set state = ?, updated_at = ? where charge_id = ?").run(updated.state, updated.updatedAt, updated.chargeId);
      this.addLedger(updated, kind, updated.amount);
      this.outbox.enqueue(makeEnvelope({ topic: state === "captured" ? "charge.captured" : "refund.issued", tenantId: ctx.tenantId, occurredAt: updated.updatedAt, correlationId: ctx.correlationId, payload: { orderId, chargeId: updated.chargeId, amount: updated.amount, currency: updated.currency } }));
    })();
    return ok(updated);
  }

  private findCharge(tenantId: string, orderId: string): Charge | undefined {
    const row = this.db.sqlite.prepare("select * from charges where tenant_id = ? and order_id = ?").get(tenantId, orderId) as Record<string, unknown> | undefined;
    return row ? {
      chargeId: String(row.charge_id), tenantId: String(row.tenant_id), orderId: String(row.order_id),
      amount: Number(row.amount), currency: String(row.currency), state: row.state as Charge["state"],
      ...(row.payment_ref === null ? {} : { paymentRef: String(row.payment_ref) }), updatedAt: Number(row.updated_at),
    } : undefined;
  }

  private addLedger(charge: Charge, kind: LedgerEntry["kind"], amount: number): void {
    this.db.sqlite.prepare("insert into ledger (entry_id, tenant_id, order_id, kind, amount, currency, at, ref) values (?, ?, ?, ?, ?, ?, ?, ?)").run(newId(), charge.tenantId, charge.orderId, kind, amount, charge.currency, charge.updatedAt, charge.chargeId);
  }
}