import "../sdk-config.ts";
import type { ObserverGroup } from "@matter/main";
import { type ClientNode, ClusterBehavior, type Endpoint } from "@matter/main/node";
import { Invoke, Read, Write, type WriteResult } from "@matter/main/protocol";
import { AttributeId, ClusterId, CommandId, EndpointNumber, Status, TlvOfModel } from "@matter/main/types";

import { IntegrationError, ValidationError } from "@nedalto/contract/common/errors.ts";
import type { EndpointId } from "@nedalto/contract/common/ids.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    EndpointNotFoundError,
} from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";
import type { AttributeState, AttributeValue, ClusterState, EndpointShape } from "@nedalto/contract/endpoint/types.ts";
import type { DomainEventBus } from "@nedalto/contract/events.ts";

import { findSpecAttribute, findSpecCommand } from "../clusters.ts";
import { classifyAttributeStatus, classifyCommandStatus, classifyInteractionError } from "../errors.ts";
import type { Identity, TrackedNode } from "../identity.ts";
import { normalizeValue } from "../values.ts";

type Path = "clusterId" | "attributeId" | "commandId" | "value" | "args";

/** A `ValidationError` in the shape that schema validation gives its issues. */
const invalid = (issues: readonly { path: Path; message: string }[], cause?: unknown): ValidationError =>
    new ValidationError("Invalid input", { cause, data: { issues } });

/** Throws a `ValidationError` for each of the ids that Matter has no way to address. */
function assertAddressable(clusterId: number, element: { path: "attributeId" | "commandId"; id: number }): void {
    const issues: { path: Path; message: string }[] = [];
    if (!ClusterId.isValid(clusterId)) {
        issues.push({ path: "clusterId", message: "clusterId is not a Matter cluster id" });
    }
    const valid = element.path === "attributeId" ? AttributeId.isValid(element.id) : CommandId.isValid(element.id);
    if (!valid) {
        issues.push({ path: element.path, message: `${element.path} is not a Matter ${element.path.slice(0, -2)} id` });
    }
    if (issues.length > 0) {
        throw invalid(issues);
    }
}

type AttributeOutcome = { readonly value: unknown } | { readonly status: Status };

/** The first report on the attribute, or `undefined` if the device sent none. */
async function readOutcome(node: ClientNode, request: Read): Promise<AttributeOutcome | undefined> {
    for await (const chunk of node.interaction.read(request)) {
        for await (const report of chunk) {
            if (report.kind === "attr-value") {
                return { value: report.value };
            }
            if (report.kind === "attr-status") {
                return { status: report.status };
            }
        }
    }
    return undefined;
}

const clusterBehaviors = (endpoint: Endpoint): ClusterBehavior.Type[] =>
    Object.values(endpoint.behaviors.supported).filter(ClusterBehavior.is);

/** The `EndpointGateway` over the peers of the controller node. */
export class SdkEndpointGateway implements EndpointGateway {
    readonly #bus: DomainEventBus;
    readonly #identity: Identity;
    readonly #unobserve: () => void;

    constructor(bus: DomainEventBus, identity: Identity) {
        this.#bus = bus;
        this.#identity = identity;
        this.#unobserve = identity.observe((observers, tracked) => {
            this.#observe(observers, tracked);
        });
    }

    /** Stops announcing the changes of attributes. */
    close(): void {
        this.#unobserve();
    }

    async read(endpointId: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        assertAddressable(clusterId, { path: "attributeId", id: attributeId });
        const { node, number } = this.#resolve(endpointId);
        const request = Read({
            attributes: [
                {
                    endpointId: EndpointNumber(number),
                    clusterId: ClusterId(clusterId),
                    attributeId: AttributeId(attributeId),
                },
            ],
        });

        let outcome: AttributeOutcome | undefined;
        try {
            outcome = await readOutcome(node, request);
        } catch (error) {
            throw classifyInteractionError(endpointId, clusterId, error);
        }
        if (outcome === undefined) {
            throw new IntegrationError("The device answered without reporting the attribute", {
                data: { endpointId, clusterId },
            });
        }
        if ("status" in outcome) {
            throw classifyAttributeStatus(endpointId, clusterId, attributeId, outcome.status);
        }
        return normalizeValue(outcome.value);
    }

    async write(endpointId: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        assertAddressable(clusterId, { path: "attributeId", id: attributeId });
        const { node, number } = this.#resolve(endpointId);
        const spec = findSpecAttribute(clusterId, attributeId);
        if (spec === undefined) {
            throw new AttributeNotFoundError(endpointId, clusterId, attributeId);
        }

        let request: Write;
        try {
            // @matter/protocol 0.17.9: `Write()` does not check a value against the type of the attribute, so
            // that a string for a number only fails once the request is sent, and then not as a validation error.
            TlvOfModel(spec.attribute).validate(value);
            request = Write(
                Write.Attribute({
                    endpoint: EndpointNumber(number),
                    cluster: spec.cluster,
                    attributes: spec.attribute,
                    value,
                }),
            );
        } catch (error) {
            throw invalid([{ path: "value", message: "value does not fit the type of the attribute" }], error);
        }

        let statuses: WriteResult.AttributeStatus[];
        try {
            statuses = await node.interaction.write(request);
        } catch (error) {
            throw classifyInteractionError(endpointId, clusterId, error);
        }
        const refused = statuses.find(({ status }) => status !== Status.Success);
        if (refused !== undefined) {
            throw classifyAttributeStatus(endpointId, clusterId, attributeId, refused.status);
        }
    }

    async invoke(endpointId: EndpointId, clusterId: number, commandId: number, args?: AttributeValue): Promise<void> {
        assertAddressable(clusterId, { path: "commandId", id: commandId });
        const { node, number } = this.#resolve(endpointId);
        const spec = findSpecCommand(clusterId, commandId);
        if (spec === undefined) {
            throw new CommandNotFoundError(endpointId, clusterId, commandId);
        }

        let request: Invoke;
        try {
            request = Invoke({
                commands: [
                    { endpoint: EndpointNumber(number), cluster: spec.cluster, command: spec.command, fields: args },
                ],
            });
        } catch (error) {
            throw invalid([{ path: "args", message: "args do not fit the fields of the command" }], error);
        }

        // The refusal is thrown after the loop and not inside it, where the catch would take it for an SDK error.
        let refused: Status | undefined;
        try {
            for await (const chunk of node.interaction.invoke(request)) {
                for (const result of chunk) {
                    if (result.kind === "cmd-status" && result.status !== Status.Success) {
                        refused ??= result.status;
                    }
                }
            }
        } catch (error) {
            throw classifyInteractionError(endpointId, clusterId, error);
        }
        if (refused !== undefined) {
            throw classifyCommandStatus(endpointId, clusterId, commandId, refused);
        }
    }

    describe(endpointId: EndpointId): EndpointShape {
        const { node, number } = this.#resolve(endpointId);
        // `endpoints` indexes the whole tree, unlike `parts`, which holds only the direct children.
        if (!node.endpoints.has(number)) {
            throw new EndpointNotFoundError(endpointId);
        }
        const endpoint = node.endpoints.for(number);
        const clusters = clusterBehaviors(endpoint).map((behavior): ClusterState => {
            const state = endpoint.stateOf(behavior.id);
            const attributes: AttributeState[] = [];
            // @matter/types 0.17.9: `ClusterType.attributes()` leaves the global attributes out of the cluster.
            for (const [name, attribute] of Object.entries(behavior.cluster.attributes ?? {})) {
                const value = state[name];
                // An attribute that the device did not report has no value to give.
                if (value !== undefined) {
                    attributes.push({ id: attribute.id, value: normalizeValue(value) });
                }
            }
            return {
                id: behavior.cluster.id,
                attributes,
                acceptedCommands: [...endpoint.globalsOf(behavior.id).acceptedCommandList],
            };
        });
        return { deviceType: endpoint.type.deviceType, clusters };
    }

    #observe(observers: ObserverGroup, { node, endpoints }: TrackedNode): void {
        for (const [endpointId, number] of endpoints) {
            const endpoint = node.endpoints.for(number);
            for (const behavior of clusterBehaviors(endpoint)) {
                const events = endpoint.eventsOf(behavior.id);
                for (const [name, attribute] of Object.entries(behavior.cluster.attributes ?? {})) {
                    const changed = events[`${name}$Changed`];
                    if (changed === undefined) {
                        continue;
                    }
                    // @matter/node 0.17.9: `eventsOf(string)` types its observables without arguments, but an
                    // attribute's `$Changed` passes the new value first, then the old one and the context.
                    observers.on(changed, (...[value]: unknown[]) => {
                        this.#bus.emit("endpoint:changed", {
                            endpointId,
                            clusterId: behavior.cluster.id,
                            attributeId: attribute.id,
                            value: normalizeValue(value),
                            timestamp: Date.now(),
                        });
                    });
                }
            }
        }
    }

    #resolve(endpointId: EndpointId): { node: ClientNode; number: number } {
        const peer = this.#identity.endpoint(endpointId);
        if (peer === undefined) {
            throw new EndpointNotFoundError(endpointId);
        }
        return peer;
    }
}
