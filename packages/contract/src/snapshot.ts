import type { EndpointState } from "./endpoint/types.ts";
import type { NodeState } from "./node/types.ts";
import type { RoomState } from "./room/types.ts";

/** The state of the hub at the moment a client subscribes, which `hub.subscribe` returns. */
export interface Snapshot {
    readonly nodes: readonly NodeState[];
    readonly endpoints: readonly EndpointState[];
    readonly rooms: readonly RoomState[];
}
