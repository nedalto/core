import type { EventBus } from "./common/bus.ts";
import type { EndpointEvents } from "./endpoint/events.ts";
import type { NodeEvents } from "./node/events.ts";
import type { RoomEvents } from "./room/events.ts";

/** Every event on the bus. */
export type DomainEventMap = NodeEvents & EndpointEvents & RoomEvents;

export type DomainEventBus = EventBus<DomainEventMap>;

// The keys are checked against the map, so an event left out or misspelled does not compile.
const eventFlags = {
    "node:connected": true,
    "node:disconnected": true,
    "endpoint:changed": true,
    "room:added": true,
    "room:renamed": true,
    "room:removed": true,
} satisfies Record<keyof DomainEventMap, true>;

const isEventName = (name: string): name is keyof DomainEventMap => Object.hasOwn(eventFlags, name);

/** The name of every event on the bus, for whoever forwards them all. */
export const EVENT_NAMES: readonly (keyof DomainEventMap)[] = Object.keys(eventFlags).filter(isEventName);
