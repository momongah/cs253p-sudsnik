import type { Db } from "@sudsnik/infra-db";
import { err, newId, ok, sudsnikError, type Result } from "@sudsnik/kernel";
import type { Hold, HoldStore } from "@sudsnik/contracts/services/washnodes";
import { guardTransition, type StoredHold } from "../../domain/hold.js";
import type { WasherRepo } from "../../ports/washerRepo.js";

interface HoldRow {
  hold_id: string;
  tenant_id: string;
  node_id: string;
  washer_id: string;
  order_id: string;
  state: StoredHold["state"];
  acquired_at: number;
  expires_at: number;
  version: number;
  firmware_ref: string;
}

function toHold(row: HoldRow): StoredHold {
  return {
    holdId: row.hold_id,
    tenantId: row.tenant_id,
    nodeId: row.node_id,
    washerId: row.washer_id,
    orderId: row.order_id,
    state: row.state,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    version: row.version,
    firmwareRef: row.firmware_ref,
  };
}

export function sqliteHoldStore(db: Db, washers: WasherRepo): HoldStore {
  const getRow = (holdId: string): HoldRow | undefined =>
    db.readOne<HoldRow>(
      "select hold_id, tenant_id, node_id, washer_id, order_id, state, acquired_at, expires_at, version, firmware_ref from holds where hold_id = ?",
      holdId,
    );

  const transition = (holdId: string, expectedVersion: number, state: "released" | "consumed", nowMs: number, reason?: string): Result<StoredHold> =>
    db.transaction(() => {
      const current = getRow(holdId);
      const guarded = guardTransition(current ? toHold(current) : undefined, holdId, expectedVersion);
      if (!guarded.ok) return guarded;
      if (guarded.value.expiresAt <= nowMs) return err(sudsnikError("CONFLICT", `hold ${holdId} expired at ${guarded.value.expiresAt}`));
      const next = { ...guarded.value, state, version: guarded.value.version + 1 };
      const updated = db.write(
        "update holds set state = ?, version = ?, ended_at = ?, reason = ? where hold_id = ? and state = 'held' and version = ? and expires_at > ?",
        state,
        next.version,
        nowMs,
        reason ?? null,
        holdId,
        expectedVersion,
        nowMs,
      );
      if (updated.changes !== 1) return err(sudsnikError("CONFLICT", `hold ${holdId} changed while transitioning`));
      if (state === "consumed") washers.startWashing(next.washerId);
      else washers.free(next.washerId, holdId);
      return ok(next);
    });

  return {
    acquire: async (input) => {
      const firmwareRef = input.firmwareRef;
      if (!firmwareRef) return err(sudsnikError("INTERNAL", `hold for order ${input.orderId} has no firmware reference`));
      return db.transaction(() => {
        const holdId = input.holdId ?? newId();
        const reserved = db.write(
          "update washers set state = 'held', hold_id = ? where washer_id = ? and maintenance = 0 and (state = 'idle' or (state = 'held' and hold_id = ?))",
          holdId,
          input.washerId,
          holdId,
        );
        if (reserved.changes !== 1) return err(sudsnikError("QUOTA", `washer ${input.washerId} is no longer idle`));
        const hold: StoredHold = {
          holdId,
          tenantId: input.tenantId,
          nodeId: input.nodeId,
          washerId: input.washerId,
          orderId: input.orderId,
          state: "held",
          acquiredAt: input.nowMs,
          expiresAt: input.nowMs + input.ttlMs,
          version: 0,
          firmwareRef,
        };
        db.write(
          "insert into holds (hold_id, tenant_id, node_id, washer_id, order_id, state, acquired_at, expires_at, version, firmware_ref) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          hold.holdId,
          hold.tenantId,
          hold.nodeId,
          hold.washerId,
          hold.orderId,
          hold.state,
          hold.acquiredAt,
          hold.expiresAt,
          hold.version,
          hold.firmwareRef,
        );
        return ok(hold);
      });
    },
    release: async (holdId, expectedVersion, reason, nowMs) => transition(holdId, expectedVersion, "released", nowMs, reason),
    consume: async (holdId, expectedVersion, nowMs) => transition(holdId, expectedVersion, "consumed", nowMs),
    expire: async (nowMs) =>
      db.transaction(() => {
        const rows = db.read<HoldRow>(
          "select hold_id, tenant_id, node_id, washer_id, order_id, state, acquired_at, expires_at, version, firmware_ref from holds where state = 'held' and expires_at <= ?",
          nowMs,
        );
        const expired: Hold[] = [];
        for (const row of rows) {
          const next = { ...toHold(row), state: "expired" as const, version: row.version + 1 };
          const updated = db.write(
            "update holds set state = 'expired', version = ?, ended_at = ? where hold_id = ? and state = 'held' and version = ?",
            next.version,
            nowMs,
            row.hold_id,
            row.version,
          );
          if (updated.changes !== 1) continue;
          washers.free(next.washerId, next.holdId);
          expired.push(next);
        }
        return ok(expired);
      }),
    get: async (holdId) => {
      const row = getRow(holdId);
      return row ? ok(toHold(row)) : err(sudsnikError("NOT_FOUND", `no hold ${holdId}`));
    },
  };
}
