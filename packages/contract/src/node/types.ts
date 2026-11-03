import type { EndpointId, NodeId } from "../common/ids.ts";
import type { EndpointRecord } from "../endpoint/types.ts";

/** What is stored for a node. */
export interface NodeRecord {
    readonly id: NodeId;

    /** The Matter node id, an unsigned 64-bit integer. */
    readonly matterId: bigint;
}

/**
 * How the hub stands with a node now. Only `connected` means that its data is up to date.
 * See `docs/protocol.md` for what each value means to a client.
 */
export type NodeConnection = "connected" | "disconnected" | "reconnecting" | "waiting-for-discovery";

/** What a client sees of a node. */
export interface NodeState {
    readonly id: NodeId;
    readonly connection: NodeConnection;
}

/** What a node reports about itself, from its Basic Information cluster. */
export interface NodeInfo {
    readonly id: NodeId;

    /** The Matter node id, an unsigned 64-bit integer. */
    readonly matterId: bigint;

    /** Epoch milliseconds of the commissioning, or `null` when the node does not report it. */
    readonly commissionedAt: number | null;

    /** The label any administrator of the node may set; empty when there is none. */
    readonly label: string;

    readonly vendorName: string;
    readonly productName: string;
    readonly vendorId: number;
    readonly productId: number;
    readonly hardwareVersion: number;
    readonly softwareVersion: number;
    readonly softwareVersionString: string;
}

/** A node that joined the fabric, with one record per endpoint it exposes. */
export interface CommissioningResult {
    readonly node: NodeRecord;
    readonly endpoints: readonly EndpointRecord[];
}

/** How the endpoints of a node differ from those the hub had registered for it. */
export interface EndpointChanges {
    readonly added: readonly EndpointRecord[];
    readonly removed: readonly EndpointId[];
}
