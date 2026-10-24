# 0005. Synchronous in-process event bus

Status: Accepted

## Context

What changes the state of the home, the use cases of `packages/server` and the gateways of `packages/matter`, announces it as domain events, and the server forwards them to subscribed connections.
The protocol promises an order to clients: no event between the snapshot and the first notification, and the event of a write before the response to the request that made it ([the protocol](../protocol.md#subscription-and-order)).

## Decision

`apps/hub` owns one bus that implements `DomainEventBus`, whose `emit` calls every handler of the event, in the order they subscribed, before it returns.
A handler that throws is logged and does not stop the others or reach the emitter.

The order the protocol promises follows from that: a use case writes, emits and only then returns its result, and `hub.subscribe` composes the snapshot, sends it and adds the subscriber with no `await` in between.

## Alternatives

- **Node's `EventEmitter`**: it is synchronous too, but rethrows a handler's error to the emitter, so a failing subscriber would fail the write that emitted.
- **Asynchronous delivery**, on a microtask or a queue: a slow handler would no longer delay the emitter, but events could land after the response they belong before, and clients would have to reorder them.
- **A message broker** such as MQTT: there is one process and one consumer, and it would add a dependency and a way to fail with nothing to gain.

## Consequences

Handlers must be quick and must not `await`, because they run inside the emitter's call.
Revisit if a consumer has slow work to do or another process needs the events.
