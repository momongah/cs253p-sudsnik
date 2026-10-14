import type { ServiceDeps } from "@sudsnik/contracts";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";

export const VERSION = "1.0.0";

export function baseApp(deps: ServiceDeps, variant: string): Promise<App & { sudsnik: SudsnikApp }> {
  return createBaseApp({
    deps,
    version: VERSION,
    variant,
    cost: () => ({ service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} }),
  });
}
