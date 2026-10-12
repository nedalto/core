import type { EndpointId, NodeId, RoomId } from "@nedalto/contract/common/ids.ts";
import type { EndpointRepository } from "@nedalto/contract/endpoint/ports.ts";
import type { EndpointRecord } from "@nedalto/contract/endpoint/types.ts";
import type { NodeRepository } from "@nedalto/contract/node/ports.ts";
import type { NodeRecord } from "@nedalto/contract/node/types.ts";

/** A `NodeRepository` in memory. The package only reads it, and the tests fill it. */
export class MemoryNodeRepository implements NodeRepository {
    readonly records: NodeRecord[] = [];

    findAll(): NodeRecord[] {
        return [...this.records];
    }

    save(record: NodeRecord): void {
        this.records.push(record);
    }

    findById(_id: NodeId): never {
        throw new Error("Unexpected call");
    }

    delete(_id: NodeId): never {
        throw new Error("Unexpected call");
    }
}

/** An `EndpointRepository` in memory. The package only reads it, and the tests fill it. */
export class MemoryEndpointRepository implements EndpointRepository {
    readonly records: EndpointRecord[] = [];

    findByNode(nodeId: NodeId): EndpointRecord[] {
        return this.records.filter((record) => record.nodeId === nodeId);
    }

    save(record: EndpointRecord): void {
        this.records.push(record);
    }

    findById(_id: EndpointId): never {
        throw new Error("Unexpected call");
    }

    findAll(): never {
        throw new Error("Unexpected call");
    }

    setName(_id: EndpointId, _name: string): never {
        throw new Error("Unexpected call");
    }

    setRoom(_id: EndpointId, _roomId: RoomId | null): never {
        throw new Error("Unexpected call");
    }
}
