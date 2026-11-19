import { NotFoundError } from "../common/errors.ts";
import type { RoomId } from "../common/ids.ts";

/** The room does not exist. */
export class RoomNotFoundError extends NotFoundError {
    declare readonly data: { readonly roomId: RoomId };

    constructor(roomId: RoomId) {
        super(`Room ${roomId} not found`, { data: { roomId } satisfies RoomNotFoundError["data"] });
    }
}
