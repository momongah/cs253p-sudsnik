import { registerHandlers } from "@sudsnik/infra-queue";
import type { ErrorBody, ServiceDeps } from "@sudsnik/contracts";
import { routes } from "@sudsnik/contracts/services/billing";
import { baseApp } from "../../core/baseApp.js";

export const variant = "hollow";

export async function createApp(deps: ServiceDeps) {
  const app = await baseApp(deps, variant);
  const body: ErrorBody = { code: "UNAVAILABLE", message: `${deps.service} is hollow`, retryable: true };
  for (const route of Object.values(routes)) {
    app.route({ method: route.method, url: route.path, handler: async (_request, reply) => reply.code(501).send(body) });
  }
  for (const handler of await registerHandlers(deps)) app.sudsnik.registerStop(handler.stop);
  app.sudsnik.setReady(true);
  return app;
}
