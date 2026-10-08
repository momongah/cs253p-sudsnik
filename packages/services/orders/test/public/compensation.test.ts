import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, cancel, driveTo, fakeBilling, getOrder, place, steps, type Stack } from "../helpers.js";

let stack: Stack;
let drained = false;
beforeEach(async () => {
  stack = await boot();
  drained = false;
});
afterEach(async () => {
  if (!drained) {
    drained = true;
    await stack.app.sudsnik.drain();
  }
});

describe("compensation on cancel", () => {
  it("cancels the order, publishes the event, and refunds an authorized payment", async () => {
    const billing = fakeBilling(stack.deps);
    const order = await place(stack.app);
    await driveTo(stack, order, "delivered");
    const res = await cancel(stack.app, order.orderId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ orderId: order.orderId, state: "cancelled", cancelReason: "changed my mind", payment: "refunded" });
    expect(billing.refunds).toBe(1);
    expect(steps(stack.deps, order.orderId).map((s) => s.step)).toEqual(["place", "authorize", "pickup.scheduled", "pod.collected", "pod.delivered", "cancel", "refund"]);
    drained = true;
    await stack.app.sudsnik.drain();
    expect(stack.deps.bus.published.filter((e) => e.topic === "order.cancelled").map((e) => e.payload)).toEqual([
      { orderId: order.orderId, reason: "changed my mind", origin: "customer", compensations: ["refund", "release-hold"] },
    ]);
  });

  it("returns 404 when the order belongs to another tenant", async () => {
    const order = await place(stack.app);
    expect((await cancel(stack.app, order.orderId, "again", "op2")).statusCode).toBe(404);
    expect((await getOrder(stack.app, order.orderId)).state).toBe("placed");
  });

  it("rejects cancellation once washing has started", async () => {
    const order = await place(stack.app);
    await driveTo(stack, order, "washing");
    const res = await cancel(stack.app, order.orderId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("CONFLICT");
    expect((await getOrder(stack.app, order.orderId)).state).toBe("washing");
    expect(steps(stack.deps, order.orderId).some((s) => s.step === "cancel")).toBe(false);
  });
});
