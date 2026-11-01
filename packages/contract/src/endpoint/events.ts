import type { EndpointId, RoomId } from "../common/ids.ts";
import type { AttributeValue, EndpointState } from "./types.ts";

/** Events about endpoints. Names follow `<subject>:<verb-past-tense>`. */
export interface EndpointEvents {
    /** A node that was already in the hub gained an endpoint. */
    "endpoint:added": {
        readonly endpoint: EndpointState;
        readonly timestamp: number;
    };

    /** A node that stays in the hub lost an endpoint, and the endpoint its name and room. */
    "endpoint:removed": {
        readonly endpointId: EndpointId;
        readonly timestamp: number;
    };

    /** An attribute of the endpoint took a new value. */
    "endpoint:changed": {
        readonly endpointId: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
        readonly value: AttributeValue;
        readonly timestamp: number;
    };

    /** An endpoint was renamed. */
    "endpoint:renamed": {
        readonly endpointId: EndpointId;
        readonly name: string;
        readonly timestamp: number;
    };

    /** An endpoint was assigned to a room, or taken out of its room with `null`. */
    "endpoint:room-changed": {
        readonly endpointId: EndpointId;
        readonly roomId: RoomId | null;
        readonly timestamp: number;
    };
}
