import type { ServiceDeps } from "@sudsnik/contracts";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb, type Db } from "@sudsnik/infra-db";
import { createBaseApp, type App, type SudsnikApp } from "@sudsnik/infra-http";
import { createOutbox, registerHandlers } from "@sudsnik/infra-queue";
import { BillingServiceImpl } from "./BillingService.js";
import { bindEventSink } from "./eventSink.js";
import { migrationsDir } from "./paths.js";
import { registerRoutes } from "./routes.js";

export const VERSION = "1.0.0";

export async function composeApp(deps: ServiceDeps): Promise<App & { sudsnik: SudsnikApp }> {
  const app = await createBaseApp({ deps, version: VERSION, variant: "billing", cost: () => ({ service: deps.service, sinceMs: 0, totalUnits: 0, byOperation: {}, byEndpoint: {} }) });
  const db: Db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  app.sudsnik.registerStop(async () => db.close());
  const outbox = createOutbox(db, deps.bus);
  const service = new BillingServiceImpl(db, outbox, deps);
  bindEventSink(deps, service);
  registerRoutes(app, service);
  outbox.start();
  app.sudsnik.registerStop(() => outbox.stop());
  for (const handler of await registerHandlers(deps)) app.sudsnik.registerStop(handler.stop);
  app.sudsnik.setReady(true);
  return app;
}

export const createApp = composeApp;