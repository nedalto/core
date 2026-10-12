import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { AttributeValue, EndpointRecord, EndpointShape } from "./types.ts";

/** Persistence of endpoints. */
export interface EndpointRepository {
    findById(id: EndpointId): EndpointRecord | null;
    findAll(): EndpointRecord[];
    findByNode(nodeId: NodeId): EndpointRecord[];

    /** Inserts the record. Its node must already be saved. */
    save(record: EndpointRecord): void;

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    setName(id: EndpointId, name: string): void;

    /**
     * Assigns the room, or clears it with `null`.
     * Throws `EndpointNotFoundError` if the endpoint does not exist.
     */
    setRoom(id: EndpointId, roomId: RoomId | null): void;
}

/**
 * Operations on endpoints that talk to the Matter network.
 * Every error it throws is an `AppError`.
 * An id that Matter cannot address is a `ValidationError`, and an unknown endpoint an `EndpointNotFoundError`.
 */
export interface EndpointGateway {
    /**
     * Reads an attribute from the device.
     *
     * Throws `AttributeNotFoundError` when the device does not serve the attribute.
     * Throws `InteractionRejectedError` when the device refuses with any other status.
     * Throws `EndpointUnreachableError` when the device does not answer.
     */
    read(endpointId: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue>;

    /**
     * Writes an attribute on the device, which acknowledges it before this resolves.
     * It covers only the clusters of the Matter specification.
     *
     * Throws `AttributeNotFoundError` for an attribute the specification does not define on the cluster or the
     * device does not serve.
     * Throws `ValidationError` for a value that does not fit the type of the attribute.
     * Throws `InteractionRejectedError` when the device refuses the write with any other status, as it does for a
     * read-only attribute.
     * Throws `EndpointUnreachableError` when the device does not answer.
     */
    write(endpointId: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void>;

    /**
     * Invokes a command on the device, which acknowledges it before this resolves.
     * It covers only the clusters of the Matter specification.
     * `args` holds the fields of the command as a struct; a command without fields takes none.
     *
     * Throws `CommandNotFoundError` for a command the specification does not define on the cluster or the device
     * does not serve.
     * Throws `ValidationError` for arguments that do not fit the fields of the command.
     * Throws `InteractionRejectedError` when the device refuses the command with any other status.
     * Throws `EndpointUnreachableError` when the device does not answer.
     */
    invoke(endpointId: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void>;

    /**
     * Describes the endpoint from the last state learned from the device, without contacting it, so it also
     * answers while the node is offline.
     */
    describe(endpointId: EndpointId): EndpointShape;
}
