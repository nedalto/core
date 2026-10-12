import type { EndpointId } from "../common/ids.ts";
import type { AttributeValue } from "./types.ts";

/** Events about endpoints. Names follow `<subject>:<verb-past-tense>`. */
export interface EndpointEvents {
    /** An attribute of the endpoint took a new value. */
    "endpoint:changed": {
        readonly endpointId: EndpointId;
        readonly clusterId: number;
        readonly attributeId: number;
        readonly value: AttributeValue;
        readonly timestamp: number;
    };
}
