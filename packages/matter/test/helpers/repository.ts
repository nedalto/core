import type { NodeId } from "@nedalto/contract/common/ids.ts";
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
