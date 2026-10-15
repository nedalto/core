import type { RoomId } from "../common/ids.ts";
import type { RoomState } from "./types.ts";

/** Events about rooms. Names follow `<subject>:<verb-past-tense>`. */
export interface RoomEvents {
    /** A room was created. */
    "room:added": {
        readonly room: RoomState;
        readonly timestamp: number;
    };

    /** A room was renamed. */
    "room:renamed": {
        readonly roomId: RoomId;
        readonly name: string;
        readonly timestamp: number;
    };

    /** A room was removed, and with it the assignment of the endpoints that were in it. */
    "room:removed": {
        readonly roomId: RoomId;
        readonly timestamp: number;
    };
}
