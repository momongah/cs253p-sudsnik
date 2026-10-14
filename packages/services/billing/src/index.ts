import { bootService } from "@sudsnik/infra-boot";
import { createApp } from "./core/composeApp.js";
import { handlersDir } from "./core/paths.js";
import { readEnv } from "./env.js";

export { readEnv, handlersDir, createApp };

export async function start(): Promise<void> {
  await bootService({ service: "billing", readEnv, createApp, handlersDir });
}
