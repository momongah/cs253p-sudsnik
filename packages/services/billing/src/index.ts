import { bootService } from "@sudsnik/infra-boot";
import { handlersDir } from "./core/paths.js";
import { readEnv } from "./env.js";
import { createApp } from "./variants/golden/index.js";

export { readEnv, handlersDir, createApp };

export async function start(): Promise<void> {
  await bootService({ service: "billing", readEnv, createApp, handlersDir });
}
