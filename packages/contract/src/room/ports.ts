import type { RoomId } from "../common/ids.ts";
import type { RoomRecord } from "./types.ts";

/** Persistence of rooms. */
export interface RoomRepository {
    findById(id: RoomId): RoomRecord | null;
    findAll(): RoomRecord[];

    save(record: RoomRecord): void;

    /** Throws `RoomNotFoundError` if the room does not exist. */
    setName(id: RoomId, name: string): void;

    /**
     * Removes the room and clears it from the endpoints assigned to it.
     * Throws `RoomNotFoundError` if the room does not exist.
     */
    delete(id: RoomId): void;
}
