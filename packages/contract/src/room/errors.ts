import { NotFoundError } from "../common/errors.ts";
import type { RoomId } from "../common/ids.ts";

/** The room does not exist. */
export class RoomNotFoundError extends NotFoundError {
    constructor(roomId: RoomId) {
        super(`Room ${roomId} not found`, { data: { roomId } });
    }
}
