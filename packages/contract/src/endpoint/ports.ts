import type { EndpointId, NodeId, RoomId } from "../common/ids.ts";
import type { AttributeValue, DeviceEndpoint, EndpointRecord, EndpointShape } from "./types.ts";

/** Persistence of endpoints. */
export interface EndpointRepository {
    findById(id: EndpointId): EndpointRecord | null;
    findAll(): EndpointRecord[];
    findByNode(nodeId: NodeId): EndpointRecord[];

    /** Its node must already be stored. */
    create(endpoint: DeviceEndpoint): EndpointRecord;

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    setName(id: EndpointId, name: string): void;

    /**
     * Assigns the room, which must exist, or clears it with `null`.
     * Throws `EndpointNotFoundError` if the endpoint does not exist.
     */
    setRoom(id: EndpointId, roomId: RoomId | null): void;

    /** Throws `EndpointNotFoundError` if the endpoint does not exist. */
    delete(id: EndpointId): void;
}

/**
 * Operations on endpoints that talk to the Matter network.
 * Every error it throws is an `AppError`.
 * An id that Matter cannot address is a `ValidationError`.
 * An endpoint the controller does not expose is an `EndpointNotFoundError`: one it does not have, the root of a node,
 * and one whose structure the controller has not learned yet.
 * A cluster the endpoint does not have is rejected without contacting the device.
 */
export interface EndpointGateway {
    /**
     * Reads an attribute from the device.
     *
     * Throws `AttributeNotFoundError` when the endpoint does not have the cluster or the device does not serve the
     * attribute.
     * Throws `InteractionRejectedError` when the device refuses with any other status.
     * Throws `EndpointUnreachableError` when the device does not answer.
     */
    read(endpointId: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue>;

    /**
     * Writes an attribute on the device, which acknowledges it before this resolves.
     * An entry of a fabric-scoped list leaves out its `fabricIndex`, which the device sets, or gives the one that a
     * read returns.
     *
     * Throws `AttributeNotFoundError` for an attribute the endpoint does not have, or the device does not serve.
     * Throws `ValidationError` for a value that does not fit the type of the attribute or would not reach the device as
     * given, or that does not keep the form of values (`docs/decisions/0004-integers-and-bytes-of-device-values.md`).
     * Throws `InteractionRejectedError` when the device refuses the write with any other status, as it does for a
     * read-only attribute; it leaves the attribute as it was, but for a list too large for one message, which goes
     * entry by entry.
     * Throws `EndpointUnreachableError` when the device does not answer.
     */
    write(endpointId: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void>;

    /**
     * Invokes a command on the device and resolves with the fields of its response, or `null` for a command that
     * responds without data.
     * `args` holds the fields of the command as a struct; a command without fields takes none.
     * A `status` among the fields of a response is a field of that command, for the client to interpret, not a
     * refusal.
     *
     * Throws `CommandNotFoundError` for a command the endpoint does not accept.
     * Throws `ValidationError` for arguments that do not fit the fields of the command or would not reach the device as
     * given, or that do not keep the form of values (`docs/decisions/0004-integers-and-bytes-of-device-values.md`).
     * Throws `InteractionRejectedError` when the device refuses the command with any other status.
     * Throws `EndpointUnreachableError` when the device does not answer.
     */
    invoke(
        endpointId: EndpointId,
        clusterId: number,
        commandId: number,
        args?: AttributeValue,
    ): Promise<AttributeValue | null>;

    /**
     * Describes the endpoint from the last state learned from the device, without contacting it, so it also
     * answers while the device does not.
     */
    describe(endpointId: EndpointId): EndpointShape;
}
