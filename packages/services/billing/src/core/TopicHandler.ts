import type { Envelope, Handler, ServiceDeps } from "@sudsnik/contracts";
import { err, sudsnikError, type Result } from "@sudsnik/kernel";
import { eventSinkFor } from "./eventSink.js";

export class TopicHandler<T extends Envelope["topic"]> implements Handler {
  constructor(readonly topic: T) {}

  async handle(envelope: Envelope, deps: ServiceDeps): Promise<Result<void>> {
    const sink = eventSinkFor(deps);
    return sink ? sink.applyEvent(envelope) : err(sudsnikError("INTERNAL", "billing has no event sink"));
  }
}
