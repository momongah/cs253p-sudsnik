import type { Envelope, ServiceDeps } from "@sudsnik/contracts";
import type { Result } from "@sudsnik/kernel";
import type { BillingServiceImpl } from "./BillingService.js";

const sinks = new WeakMap<ServiceDeps, BillingServiceImpl>();
export function bindEventSink(deps: ServiceDeps, sink: BillingServiceImpl): void {
  sinks.set(deps, sink);
}
export function eventSinkFor(deps: ServiceDeps): BillingServiceImpl | undefined {
  return sinks.get(deps);
}

export interface EventSink {
  applyEvent(envelope: Envelope): Promise<Result<void>>;
}
