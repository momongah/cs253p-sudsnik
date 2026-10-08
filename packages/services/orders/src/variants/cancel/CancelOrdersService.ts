import { CANCELLABLE_STATES, type Order } from "@sudsnik/contracts/services/orders";
import type { Ctx } from "@sudsnik/contracts";
import { err, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import { COMPENSATION, ORIGIN, OrdersService, notFound } from "../../core/OrdersService.js";

export class CancelOrdersService extends OrdersService {
  async cancel(orderId: string, reason: string, ctx: Ctx): Promise<Result<Order>> {
    let refund = false;
    const result = this.inTransaction((): Result<Order> => {
      const order = this.find(ctx.tenantId, orderId);
      if (!order) return err(notFound(orderId));
      if (!CANCELLABLE_STATES.includes(order.state)) {
        return err(sudsnikError("CONFLICT", `order ${orderId} cannot be cancelled from state ${order.state}`));
      }

      const compensations = this.cancelInPlace(order, reason, ORIGIN.customer, { correlationId: ctx.correlationId });
      refund = compensations.includes(COMPENSATION.refund);
      return ok(order);
    });

    if (!result.ok) return result;
    if (refund) await this.refundFor(result.value, ctx.correlationId);
    return result;
  }
}
