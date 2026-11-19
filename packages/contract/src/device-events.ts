import type { EventBus } from "./common/bus.ts";
import type { EndpointId, NodeId } from "./common/ids.ts";
import type { NodeConnection } from "./node/types.ts";

// Every name starts with `$`, so that a reader tells these from the events clients receive.
type Prefixed<TEventMap extends { [K in keyof TEventMap]: K extends `$${string}:${string}` ? object : never }> =
    TEventMap;

/**
 * What the Matter controller notices of the devices, for the hub to act on before it tells clients.
 * Clients never receive these: they say nothing about whether the hub has stored the node or endpoint they name.
 */
export type DeviceEventMap = Prefixed<{
    /** The connection of the node took a new value. */
    "$node:connection-changed": {
        readonly nodeId: NodeId;
        readonly connection: NodeConnection;
    };

    /** The endpoints of the node may have changed: `NodeGateway.endpointsOf` says which it has. */
    "$node:endpoints-changed": {
        readonly nodeId: NodeId;
    };

    /** The controller no longer has the node, whoever removed it. */
    "$node:deleted": {
        readonly nodeId: NodeId;
    };

    /** The endpoint gained or lost clusters, or attributes within one. */
    "$endpoint:clusters-changed": {
        readonly endpointId: EndpointId;
    };
}>;

export type DeviceEventBus = EventBus<DeviceEventMap>;
