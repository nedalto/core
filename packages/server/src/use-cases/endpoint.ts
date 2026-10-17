import type { EndpointId, RoomId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";

export interface EndpointUseCaseDeps {
    readonly endpointRepository: EndpointRepository;
    readonly roomRepository: RoomRepository;
    readonly bus: DomainEventBus;
}

/** Writes what is stored about endpoints and announces each write once it is stored. */
export class EndpointUseCase {
    readonly #endpointRepository: EndpointRepository;
    readonly #roomRepository: RoomRepository;
    readonly #bus: DomainEventBus;

    constructor({ endpointRepository, roomRepository, bus }: EndpointUseCaseDeps) {
        this.#endpointRepository = endpointRepository;
        this.#roomRepository = roomRepository;
        this.#bus = bus;
    }

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    rename(id: EndpointId, name: string): void {
        this.#endpointRepository.setName(id, name);
        this.#bus.emit("endpoint:renamed", { endpointId: id, name, timestamp: Date.now() });
    }

    /** Throws `RoomNotFoundError` if the room does not exist, and `EndpointNotFoundError` if the endpoint does not. */
    assignRoom(id: EndpointId, roomId: RoomId | null): void {
        // Without this check, a missing room fails as a foreign key violation, which a client sees as INTERNAL_ERROR.
        if (roomId !== null && this.#roomRepository.findById(roomId) === null) {
            throw new RoomNotFoundError(roomId);
        }
        this.#endpointRepository.setRoom(id, roomId);
        this.#bus.emit("endpoint:room-changed", { endpointId: id, roomId, timestamp: Date.now() });
    }
}
