import type { NodeId } from "../common/ids.ts";
import type { TaggedInteger } from "../common/wire.ts";
import type { DeviceEndpoint } from "../endpoint/types.ts";

/** What is stored for a node. */
export interface NodeRecord {
    readonly id: NodeId;
}

/** How the hub stands with a node now. Only `connected` means that its data is up to date. */
export type NodeConnection = "connected" | "disconnected" | "reconnecting" | "waiting-for-discovery";

/** What a node reports about itself, from its Basic Information cluster. */
export interface NodeInfo {
    readonly id: NodeId;

    /**
     * The Matter node id, an unsigned 64-bit integer, in the form of any integer on the wire, so that it compares with
     * a node id inside a value, such as an ACL subject.
     * See `docs/decisions/0004-integers-and-bytes-of-device-values.md`.
     */
    readonly matterId: number | TaggedInteger;

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

/** A node that joined the fabric, with the endpoints it exposes. */
export interface CommissioningResult {
    readonly nodeId: NodeId;
    readonly endpoints: readonly DeviceEndpoint[];
}
