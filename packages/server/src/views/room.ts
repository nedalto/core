import type { RoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";
import type { RoomState } from "@nedalto/contract/room/types.ts";

/** What a client sees of the rooms. */
export class RoomView {
    readonly #repository: RoomRepository;

    constructor(repository: RoomRepository) {
        this.#repository = repository;
    }

    list(): RoomState[] {
        return this.#repository.findAll();
    }

    /** Throws `RoomNotFoundError` if the room does not exist. */
    get(id: RoomId): RoomState {
        const room = this.#repository.findById(id);
        if (room === null) {
            throw new RoomNotFoundError(id);
        }
        return room;
    }
}
