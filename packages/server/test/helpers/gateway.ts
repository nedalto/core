import type { EndpointId, NodeId } from "@nedalto/contract/common/ids.ts";
import { EndpointNotFoundError } from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";
import type { AttributeValue, EndpointShape } from "@nedalto/contract/endpoint/types.ts";
import { NodeNotFoundError } from "@nedalto/contract/node/errors.ts";
import type { NodeGateway } from "@nedalto/contract/node/ports.ts";
import type { CommissioningResult, NodeInfo } from "@nedalto/contract/node/types.ts";

/** A `NodeGateway` that answers from what a test sets and keeps what it was asked. */
export class FakeNodeGateway implements NodeGateway {
    /** What `commission` resolves with. */
    commissioned: CommissioningResult | undefined;

    /** What `commission` throws, once, in place of commissioning. */
    commissionFailure: Error | undefined;

    /** What `decommission` throws, once, in place of removing the node. */
    decommissionFailure: Error | undefined;

    readonly commissionCalls: string[] = [];
    readonly decommissionCalls: { nodeId: NodeId; force: boolean | undefined }[] = [];
    readonly reachable = new Set<NodeId>();
    readonly infos = new Map<NodeId, NodeInfo>();

    commission(setupCode: string): Promise<CommissioningResult> {
        this.commissionCalls.push(setupCode);
        const failure = this.commissionFailure;
        this.commissionFailure = undefined;
        if (failure !== undefined) {
            return Promise.reject(failure);
        }
        return this.commissioned === undefined
            ? Promise.reject(new Error("Nothing to commission"))
            : Promise.resolve(this.commissioned);
    }

    decommission(nodeId: NodeId, force?: boolean): Promise<void> {
        this.decommissionCalls.push({ nodeId, force });
        const failure = this.decommissionFailure;
        this.decommissionFailure = undefined;
        return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    }

    isReachable(nodeId: NodeId): boolean {
        return this.reachable.has(nodeId);
    }

    getInfo(nodeId: NodeId): NodeInfo {
        const info = this.infos.get(nodeId);
        if (info === undefined) {
            throw new NodeNotFoundError(nodeId);
        }
        return info;
    }
}

/** An `EndpointGateway` that answers from what a test sets and keeps what it was asked. */
export class FakeEndpointGateway implements EndpointGateway {
    /** The shape `describe` answers for each endpoint; one with none throws, as one without a peer does. */
    readonly shapes = new Map<EndpointId, EndpointShape>();

    /** What `read` resolves with. */
    readValue: AttributeValue = null;

    /** What `read`, `write` and `invoke` throw, once, in place of answering. */
    interactionFailure: Error | undefined;

    readonly reads: { endpointId: EndpointId; clusterId: number; attributeId: number }[] = [];
    readonly writes: { endpointId: EndpointId; clusterId: number; attributeId: number; value: AttributeValue }[] = [];
    readonly invocations: {
        endpointId: EndpointId;
        clusterId: number;
        commandId: number;
        args: AttributeValue | undefined;
    }[] = [];

    read(endpointId: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        this.reads.push({ endpointId, clusterId, attributeId });
        return this.#answer(this.readValue);
    }

    async write(endpointId: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        this.writes.push({ endpointId, clusterId, attributeId, value });
        await this.#answer(undefined);
    }

    async invoke(endpointId: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        this.invocations.push({ endpointId, clusterId, commandId, args });
        await this.#answer(undefined);
    }

    describe(endpointId: EndpointId): EndpointShape {
        const shape = this.shapes.get(endpointId);
        if (shape === undefined) {
            throw new EndpointNotFoundError(endpointId);
        }
        return shape;
    }

    #answer<T>(value: T): Promise<T> {
        const failure = this.interactionFailure;
        this.interactionFailure = undefined;
        return failure === undefined ? Promise.resolve(value) : Promise.reject(failure);
    }
}
