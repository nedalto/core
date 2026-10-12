import type { EventBus } from "./common/bus.ts";
import type { NodeEvents } from "./node/events.ts";

/** Every event on the bus. */
export type DomainEventMap = NodeEvents;

export type DomainEventBus = EventBus<DomainEventMap>;
