import { createRoomId, type RoomId } from "@nedalto/contract/common/ids.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";

export interface RoomUseCaseDeps {
    readonly roomRepository: RoomRepository;
    readonly bus: DomainEventBus;
}

/** Writes rooms and announces each write once it is stored. */
export class RoomUseCase {
    readonly #roomRepository: RoomRepository;
    readonly #bus: DomainEventBus;

    constructor({ roomRepository, bus }: RoomUseCaseDeps) {
        this.#roomRepository = roomRepository;
        this.#bus = bus;
    }

    create(name: string): RoomId {
        const id = createRoomId();
        this.#roomRepository.save({ id, name });
        this.#bus.emit("room:added", { room: { id, name }, timestamp: Date.now() });
        return id;
    }

    /** Throws `RoomNotFoundError` if the room does not exist. */
    rename(id: RoomId, name: string): void {
        this.#roomRepository.setName(id, name);
        this.#bus.emit("room:renamed", { roomId: id, name, timestamp: Date.now() });
    }

    /** Throws `RoomNotFoundError` if the room does not exist. */
    remove(id: RoomId): void {
        this.#roomRepository.delete(id);
        this.#bus.emit("room:removed", { roomId: id, timestamp: Date.now() });
    }
}
