import type { NodeId } from "../common/ids.ts";
import type { DeviceEndpoint } from "../endpoint/types.ts";
import type { CommissioningResult, NodeConnection, NodeInfo, NodeRecord } from "./types.ts";

/** Persistence of nodes. */
export interface NodeRepository {
    findById(id: NodeId): NodeRecord | null;
    findAll(): NodeRecord[];

    create(id: NodeId): NodeRecord;

    /**
     * Removes the node together with its endpoints.
     * Throws `NodeNotFoundError` if the node does not exist.
     */
    delete(id: NodeId): void;
}

/**
 * Operations on nodes that talk to the Matter network.
 * Every error it throws is an `AppError`.
 */
export interface NodeGateway {
    /**
     * Joins the device that the setup code names to the fabric, from its manual pairing code or its QR payload.
     * It stores nothing: persisting the result is up to the caller.
     * The endpoints of the result leave out endpoint 0, which holds the node's own administration.
     *
     * Throws `ValidationError` for a setup code that cannot be read or a QR payload that names several devices.
     * Throws `CommissioningRejectedError` when the device refuses the fabric, as `already-commissioned` for one
     * dropped with `decommission(nodeId, true)`, which keeps the fabric until it is factory reset.
     * Throws `CommissioningFailedError` when the device is not found or pairing fails.
     */
    commission(setupCode: string): Promise<CommissioningResult>;

    /**
     * Removes the node from the fabric, so the hub no longer controls it.
     * With `force` the node is dropped without contacting the device, which keeps the fabric.
     * Once it succeeds, `$node:deleted` has been emitted for the node, as for any node the controller no longer has.
     *
     * Throws `NodeNotFoundError` for an unknown node.
     * Throws `NodeUnreachableError` when the device does not answer, and then the node is kept.
     * Throws `DecommissioningRejectedError` when the node is already being removed.
     */
    decommission(nodeId: NodeId, force?: boolean): Promise<void>;

    /** How the hub stands with the node now. It does not contact the device, and an unknown node is `disconnected`. */
    connectionOf(nodeId: NodeId): NodeConnection;

    /**
     * What the node reports about itself, or `null` before the controller has read its structure, as `endpointsOf`.
     *
     * Throws `NodeNotFoundError` for an unknown node.
     */
    getInfo(nodeId: NodeId): NodeInfo | null;

    /**
     * The endpoints the node has now, as `commission` returns them, or `null` before the controller has read its
     * structure.
     *
     * Throws `NodeNotFoundError` for an unknown node.
     */
    endpointsOf(nodeId: NodeId): readonly DeviceEndpoint[] | null;
}
