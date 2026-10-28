import { describe, expect, it } from "vitest";
import { HOLD_TTL_MS, MINUTE_MS, ORBIT_MS } from "@sudsnik/contracts";
import { harness, type Variant } from "../helpers.js";


/** The behaviour every variant of this seam owes, run once per variant a tree has. */
export function expirySuite(variants: Variant[]): void {
  describe.each(variants)("$name hold expiry", (variant) => {
    it("expires a hold one orbit after it was acquired, publishes hold.expired once, and frees the washer", async () => {
      const h = await harness(variant);
      const hold = (await h.acquire("B", "o1")).body;
      await h.advance(HOLD_TTL_MS - MINUTE_MS);
      expect(await h.events("hold.expired")).toHaveLength(0);
      await h.advance(MINUTE_MS);
      expect((await h.events("hold.expired")).map((e) => e.payload)).toEqual([{ holdId: hold.holdId, washerId: hold.washerId, orderId: "o1" }]);
      await h.advance(2 * MINUTE_MS);
      expect(await h.events("hold.expired")).toHaveLength(1);
      expect((await h.status("B")).body.washers.find((w) => w.washerId === hold.washerId)?.state).toBe("idle");
      await h.close();
    });

    it("refuses to start a cycle on an expired hold with 409, and to release it", async () => {
      const h = await harness(variant);
      const hold = (await h.acquire("A", "o1")).body;
      await h.advance(ORBIT_MS);
      const started = await h.start(hold.holdId);
      expect(started.status).toBe(409);
      expect(started.body).toMatchObject({ code: "CONFLICT" });
      expect((await h.release(hold.holdId)).status).toBe(409);
      expect(await h.events("wash.started")).toHaveLength(0);
      await h.close();
    });

    it("refuses to start a cycle whose hold is past expiresAt even before the sweep has run", async () => {
      const h = await harness(variant);
      const hold = (await h.acquire("A", "o1")).body;
      h.deps.clock.advanceTo(hold.expiresAt);
      expect((await h.start(hold.holdId)).status).toBe(409);
      await h.close();
    });

    it("does not expire a consumed hold after its original expiry", async () => {
      const h = await harness(variant);
      const hold = (await h.acquire("B", "o1")).body;
      expect((await h.start(hold.holdId)).status).toBe(201);
      await h.advance(HOLD_TTL_MS + MINUTE_MS);
      expect(await h.events("hold.expired")).toHaveLength(0);
      await h.close();
    });

    it("preserves a live hold across restart and expires it once afterward", async () => {
      const first = await harness(variant);
      const hold = (await first.acquire("B", "restart-order")).body;
      const dataDir = first.deps.dataDir;
      await first.close();

      const restarted = await harness(variant, undefined, dataDir);
      expect((await restarted.status("B")).body.washers.find((washer) => washer.washerId === hold.washerId)).toMatchObject({
        state: "held",
        holdId: hold.holdId,
      });
      expect((await restarted.release(hold.holdId, "restart cleanup")).status).toBe(200);
      expect((await restarted.status("B")).body.washers.find((washer) => washer.washerId === hold.washerId)?.state).toBe("idle");
      await restarted.close();

      const expiryFirst = await harness(variant);
      const expiring = (await expiryFirst.acquire("B", "restart-expiry")).body;
      const expiryDataDir = expiryFirst.deps.dataDir;
      await expiryFirst.close();

      const expiryRestart = await harness(variant, undefined, expiryDataDir);
      await expiryRestart.advance(expiring.expiresAt);
      expect((await expiryRestart.events("hold.expired")).map((event) => event.payload)).toEqual([
        { holdId: expiring.holdId, washerId: expiring.washerId, orderId: "restart-expiry" },
      ]);
      expect(await expiryRestart.events("hold.expired")).toHaveLength(1);
      expect((await expiryRestart.status("B")).body.washers.find((washer) => washer.washerId === expiring.washerId)?.state).toBe("idle");
      await expiryRestart.close();
    });
  });
}
