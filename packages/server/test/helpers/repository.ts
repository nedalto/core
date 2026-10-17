import type { EndpointId, NodeId, RoomId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";
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

/** The errors a test arms on a repository: the named method throws its error on its next call, once. */
class Failures<TMethod extends string> {
    readonly #armed = new Map<TMethod, Error>();

    arm(method: TMethod, error: Error): void {
        this.#armed.set(method, error);
    }

    check(method: TMethod): void {
        const error = this.#armed.get(method);
        this.#armed.delete(method);
        if (error !== undefined) {
            throw error;
        }
    }
}

/** A `NodeRepository` in memory, which a test can make fail or observe. */
export class MemoryNodeRepository implements NodeRepository {
    readonly records = new Map<NodeId, NodeRecord>();
    readonly failures = new Failures<"findById" | "findAll" | "save" | "delete">();

    /** Called while a node is saved, before it is stored. */
    onSave: (() => void) | undefined;

    findById(id: NodeId): NodeRecord | null {
        this.failures.check("findById");
        return this.records.get(id) ?? null;
    }

    findAll(): NodeRecord[] {
        this.failures.check("findAll");
        return [...this.records.values()];
    }

    save(record: NodeRecord): void {
        this.failures.check("save");
        this.onSave?.();
        this.records.set(record.id, record);
    }

    delete(id: NodeId): void {
        this.failures.check("delete");
        if (!this.records.delete(id)) {
            throw new NodeNotFoundError(id);
        }
    }
}

/** An `EndpointRepository` in memory, which a test can make fail or observe. */
export class MemoryEndpointRepository implements EndpointRepository {
    readonly records = new Map<EndpointId, EndpointRecord>();
    readonly failures = new Failures<"findById" | "findAll" | "save" | "setName" | "setRoom">();

    /** Called while an endpoint is saved, before it is stored. */
    onSave: (() => void) | undefined;

    findById(id: EndpointId): EndpointRecord | null {
        this.failures.check("findById");
        return this.records.get(id) ?? null;
    }

    findAll(): EndpointRecord[] {
        this.failures.check("findAll");
        return [...this.records.values()];
    }

    findByNode(): never {
        throw new Error("Unexpected call");
    }

    save(record: EndpointRecord): void {
        this.failures.check("save");
        this.onSave?.();
        this.records.set(record.id, record);
    }

    setName(id: EndpointId, name: string): void {
        this.failures.check("setName");
        this.#update(id, { name });
    }

    setRoom(id: EndpointId, roomId: RoomId | null): void {
        this.failures.check("setRoom");
        this.#update(id, { roomId });
    }

    #update(id: EndpointId, changes: Partial<EndpointRecord>): void {
        const record = this.records.get(id);
        if (record === undefined) {
            throw new EndpointNotFoundError(id);
        }
        this.records.set(id, { ...record, ...changes });
    }
}
