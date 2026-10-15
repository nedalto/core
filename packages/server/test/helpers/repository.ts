import type { RoomId } from "@nedalto/contract/common/ids.ts";
import { RoomNotFoundError } from "@nedalto/contract/room/errors.ts";
import type { RoomRepository } from "@nedalto/contract/room/ports.ts";
import type { RoomRecord } from "@nedalto/contract/room/types.ts";

/** A `RoomRepository` in memory, which a test can make fail or observe. */
export class MemoryRoomRepository implements RoomRepository {
    readonly records = new Map<RoomId, RoomRecord>();

    /** Thrown by the next call of any method, once. */
    failure: Error | undefined;

    /** Called while the rooms are listed, before they are returned. */
    onFindAll: (() => void) | undefined;

    findById(id: RoomId): RoomRecord | null {
        this.#failIfAsked();
        return this.records.get(id) ?? null;
    }

    findAll(): RoomRecord[] {
        this.#failIfAsked();
        this.onFindAll?.();
        return [...this.records.values()];
    }

    save(record: RoomRecord): void {
        this.#failIfAsked();
        this.records.set(record.id, record);
    }

    setName(id: RoomId, name: string): void {
        this.#failIfAsked();
        const record = this.records.get(id);
        if (record === undefined) {
            throw new RoomNotFoundError(id);
        }
        this.records.set(id, { ...record, name });
    }

    delete(id: RoomId): void {
        this.#failIfAsked();
        if (!this.records.delete(id)) {
            throw new RoomNotFoundError(id);
        }
    }

    #failIfAsked(): void {
        const failure = this.failure;
        this.failure = undefined;
        if (failure !== undefined) {
            throw failure;
        }
    }
}
