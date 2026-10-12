import type { EventBus } from "./common/bus.ts";
import type { EndpointEvents } from "./endpoint/events.ts";
import type { NodeEvents } from "./node/events.ts";

/** Every event on the bus. */
export type DomainEventMap = NodeEvents & EndpointEvents;

export type DomainEventBus = EventBus<DomainEventMap>;
