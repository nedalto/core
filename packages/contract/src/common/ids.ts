declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** A commissioned device: the unit of commissioning, persistence and reachability. */
export type NodeId = Brand<string, "NodeId">;

/** A functional unit of a node, what the user sees as a device: a light, a switch, a sensor. */
export type EndpointId = Brand<string, "EndpointId">;

/** A user-defined group of endpoints, with no Matter counterpart. */
export type RoomId = Brand<string, "RoomId">;

function createId(): string {
    // Looked up on call instead of imported, so browser clients, which only receive ids, can load
    // this module without their bundler trying to resolve node:crypto.
    const crypto = globalThis.process?.getBuiltinModule?.("node:crypto");
    if (crypto === undefined) {
        throw new Error("Ids can only be created where node:crypto is available");
    }
    // v7 sorts by creation time, which keeps the database indexes compact.
    return crypto.randomUUIDv7();
}

export const createNodeId = (): NodeId => createId() as NodeId;
export const createEndpointId = (): EndpointId => createId() as EndpointId;
export const createRoomId = (): RoomId => createId() as RoomId;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Whether `value` has the form the factories create: a lowercase UUID v7.
 * Whether an entity with that id exists is for the repositories to answer.
 */
export const isUuidV7 = (value: unknown): boolean => typeof value === "string" && UUID_V7.test(value);
