# 0008. Endpoints that change on the device

Status: Accepted

## Context

A device changes its endpoints by itself: a bridge gains and loses the devices behind it, also while the hub is down.
And the SDK deletes a node by itself when the device leaves the fabric.
Clients name endpoints by ids of the hub and give them names and rooms, so the hub has to keep `hub.db` and the clients up to date with what the device has.

## Decision

`packages/matter` detects and `packages/server` stores and announces:

- `NodeGateway.onStructureChanged` says which node may have changed, and `NodeGateway.reconcileEndpoints` compares the endpoints the SDK has with those `Identity` holds, by Matter endpoint number, updates `Identity` and returns the difference.
  Reconciling is idempotent, so there is no timer and no grouping of bursts: each notice finds the difference that is left.
- `NodeGateway.onNodeDeleted` says that the SDK deleted a node that `decommission` did not ask for.
- `DeviceSync` (`packages/server/src/device-sync.ts`) reacts to both: it stores the difference in one transaction and then emits `endpoint:removed` and `endpoint:added`, or deletes the node and emits `node:removed`.
  From the gateway to the emit it is synchronous, which is what keeps `endpoint:changed` from coming before `endpoint:added` ([the protocol](../protocol.md#nodes-endpoints-and-rooms)).

`DeviceSync` subscribes and then reconciles every node, before the HTTP server starts, so nothing is left between the two.
A failure to store fails the start.
While running it is logged and nothing is emitted: `Identity` stays ahead of the database until the next start finds the difference again.

`Identity` registers every stored endpoint of a node that has a peer, also those the SDK does not have, so that the comparison can report them.

## Alternatives

- **Emitting from the gateway as an event of the bus**: `HttpServer` forwards every event of the bus to the clients, so a client would see the notice, and it would see it before the change is stored.
- **Not storing the endpoints**: reading them from the SDK alone would lose the names and rooms clients give them, and the ids clients know them by across restarts.

## Consequences

An endpoint is identified by its node and Matter endpoint number.
A bridge that reuses a number at once, which the Matter specification forbids, is not detected: the SDK reports no removal and no addition (`@matter/node` 0.18.0, whose `ClientStructure` erases only the endpoints that the root's `PartsList` no longer names), so the endpoint keeps its id, name and room with the state of the new device.

`parentId` is read from the SDK each time, and the SDK never reparents an endpoint (`@matter/node` 0.18.0): a device that moves an endpoint without removing it and adding it again keeps the old parent.

The `start()` pass compares against the structure of the SDK's storage (`@matter/node` 0.18.0: a known peer is seeded from it).
What the device changed while the hub was down arrives when the node connects again, after the hub is already listening, so it comes as a live change: clients get it as events, and a failure to store it does not fail the start.

A commissioning registers the node in `Identity` a few microtasks before the use case stores it, with no I/O in between.
A change of structure that the SDK reports in that gap cannot be stored, as its endpoints would come before their node: it is logged as an error, and the next start settles it.

Revisit if a device needs to be told apart from another that reuses its number, which would take a stable id such as the `UniqueID` of a bridged device.
