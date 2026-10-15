import type { RoomId } from "../common/ids.ts";

/** What is stored for a room. */
export interface RoomRecord {
    readonly id: RoomId;
    readonly name: string;
}

/** What a client sees of a room. */
export type RoomState = RoomRecord;
