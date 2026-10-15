import type { RoomState } from "./room/types.ts";

/** The state of the hub at the moment a client subscribes, which `hub.subscribe` returns. */
export interface Snapshot {
    readonly rooms: readonly RoomState[];
}
