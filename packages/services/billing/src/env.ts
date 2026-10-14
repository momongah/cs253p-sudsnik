import { BillingEnvSchema, type BillingEnv } from "@sudsnik/contracts/services/billing";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

export function readEnv(): Result<BillingEnv> {
  return readEnvWith(BillingEnvSchema);
}