import type { ServiceDeps } from "@sudsnik/contracts";
import { composeApp } from "../../core/composeApp.js";
import { CancelOrdersService } from "./CancelOrdersService.js";

export const variant = "cancel";

export function createApp(deps: ServiceDeps) {
  return composeApp(deps, { variant, service: (parts) => new CancelOrdersService(parts.repo, parts.outbox, parts.deps) });
}
