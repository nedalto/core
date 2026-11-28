import "../sdk-config.ts";
import { type Duration, ObserverGroup, Seconds } from "@matter/main";
import { ChangeNotificationService, ClientNode, ClusterBehavior, type ServerNode } from "@matter/main/node";
import type { ClientRequest, ResultStatus, WriteResult } from "@matter/main/protocol";
import { AttributeId, ClusterId, CommandId, Status } from "@matter/main/types";

import { IntegrationError, ValidationError, type ValidationIssue } from "@nedalto/contract/common/errors.ts";
import type { EndpointId } from "@nedalto/contract/common/ids.ts";
import type { DeviceEventBus } from "@nedalto/contract/device-events.ts";
import {
    AttributeNotFoundError,
    CommandNotFoundError,
    EndpointNotFoundError,
} from "@nedalto/contract/endpoint/errors.ts";
import type { EndpointGateway } from "@nedalto/contract/endpoint/ports.ts";
import type { AttributeState, AttributeValue, ClusterState, EndpointShape } from "@nedalto/contract/endpoint/types.ts";

import { endpointIdOf, endpointOf, isExposed, nodeIdOf, type PeerEndpoint } from "../addressing.ts";
import { classifyAttributeStatus, classifyCommandStatus, classifyInteractionError } from "../classify.ts";
import { normalizeValue } from "../normalize.ts";
import { invokeRequest, readRequest, writeRequest } from "../request.ts";

type AttributeOutcome = { readonly value: unknown } | ResultStatus;

type Limited = Pick<ClientRequest, "abort" | "icdAwaitTimeout">;

type Issue = ValidationIssue & { readonly path: "clusterId" | "attributeId" | "commandId" };

// An id that Matter has no way to address is a ValidationError, with an issue for each, before anything else:
// @matter/types 0.18.0 throws for it in `ClusterId()`, which the gateway calls before it builds the request.
function assertAddressable(clusterId: number, element: { path: "attributeId" | "commandId"; id: number }): void {
    const issues: Issue[] = [];
    if (!ClusterId.isValid(clusterId)) {
        issues.push({ path: "clusterId", message: "clusterId is not a Matter cluster id" });
    }
    const valid = element.path === "attributeId" ? AttributeId.isValid(element.id) : CommandId.isValid(element.id);
    if (!valid) {
        issues.push({ path: element.path, message: `${element.path} is not a Matter ${element.path.slice(0, -2)} id` });
    }
    if (issues.length > 0) {
        throw new ValidationError("Invalid input", { issues });
    }
}

/** The `EndpointGateway` over the peers of the controller node, which reports changes of attributes on `bus`. */
export class MatterEndpointGateway implements EndpointGateway {
    readonly #bus: DeviceEventBus;
    readonly #controller: ServerNode;
    readonly #limit: Duration;
    readonly #observers = new ObserverGroup();

    /**
     * `limit` is how long a request to a sleeping device waits for it to wake, before it fails as `asleep`; a request
     * still unanswered 5 s after it fails as `no-response`. Tests pass a shorter one.
     */
    constructor(bus: DeviceEventBus, controller: ServerNode, limit = Seconds(10)) {
        this.#bus = bus;
        this.#controller = controller;
        this.#limit = limit;
        // @matter/node 0.18.0: the service of the controller reports the changes of its peers, and of its own
        // endpoints too. It logs an observer that throws and goes on, so a throw loses only the rest of that change.
        this.#observers.on(controller.env.get(ChangeNotificationService).change, (change) => {
            this.#report(change);
        });
    }

    /** Stops reporting the changes of attributes. */
    close(): void {
        this.#observers.close();
    }

    async read(endpointId: EndpointId, clusterId: number, attributeId: number): Promise<AttributeValue> {
        assertAddressable(clusterId, { path: "attributeId", id: attributeId });
        const { peer, endpoint } = this.#resolve(endpointId);
        if (endpoint.behaviors.forCluster(ClusterId(clusterId)) === undefined) {
            throw new AttributeNotFoundError(endpointId, clusterId, attributeId);
        }
        const request = readRequest(endpoint.number, clusterId, attributeId);

        const outcome = await this.#limited(
            endpointId,
            clusterId,
            async (limits): Promise<AttributeOutcome | undefined> => {
                for await (const chunk of peer.interaction.read({ ...request, ...limits })) {
                    for await (const report of chunk) {
                        if (report.kind === "attr-value") {
                            return { value: report.value };
                        }
                        if (report.kind === "attr-status") {
                            return report;
                        }
                    }
                }
                return undefined;
            },
        );
        if (outcome === undefined) {
            throw new IntegrationError("The device answered without reporting the attribute", {
                data: { endpointId, clusterId },
            });
        }
        if ("status" in outcome) {
            throw classifyAttributeStatus(endpointId, clusterId, attributeId, outcome);
        }
        return normalizeValue(outcome.value);
    }

    async write(endpointId: EndpointId, clusterId: number, attributeId: number, value: AttributeValue): Promise<void> {
        assertAddressable(clusterId, { path: "attributeId", id: attributeId });
        const { peer, endpoint } = this.#resolve(endpointId);
        const cluster = endpoint.behaviors.forCluster(ClusterId(clusterId))?.cluster;
        const attribute =
            cluster === undefined
                ? undefined
                : Object.values(cluster.attributes ?? {}).find((candidate) => candidate.id === attributeId);
        if (cluster === undefined || attribute === undefined) {
            throw new AttributeNotFoundError(endpointId, clusterId, attributeId);
        }

        // @matter/node 0.18.0: the index from the commissioning, or from the device itself for a node that lacks it.
        // `peerAddress.fabricIndex` is another, the index that the hub gave its own fabric.
        const { fabricIndexOnPeer } = peer.state.commissioning;
        const request = writeRequest(endpoint.number, cluster, attribute, value, fabricIndexOnPeer);

        const statuses: WriteResult.AttributeStatus[] = await this.#limited(endpointId, clusterId, (limits) =>
            peer.interaction.write({ ...request, ...limits }),
        );
        const refused = statuses.find(({ status }) => status !== Status.Success);
        if (refused !== undefined) {
            throw classifyAttributeStatus(endpointId, clusterId, attributeId, refused);
        }
    }

    async invoke(
        endpointId: EndpointId,
        clusterId: number,
        commandId: number,
        args?: AttributeValue,
    ): Promise<AttributeValue | null> {
        assertAddressable(clusterId, { path: "commandId", id: commandId });
        const { peer, endpoint } = this.#resolve(endpointId);
        const cluster = endpoint.behaviors.forCluster(ClusterId(clusterId))?.cluster;
        const command =
            cluster === undefined
                ? undefined
                : Object.values(cluster.commands ?? {}).find((candidate) => candidate.id === commandId);
        if (cluster === undefined || command === undefined) {
            throw new CommandNotFoundError(endpointId, clusterId, commandId);
        }

        const request = invokeRequest(endpoint.number, cluster, command, args);

        // The refusal is thrown and the response normalized after the loop, not inside it, where an error would be
        // taken for one of the SDK.
        let refused: ResultStatus | undefined;
        let response: unknown;
        await this.#limited(endpointId, clusterId, async (limits) => {
            for await (const chunk of peer.interaction.invoke({ ...request, ...limits })) {
                for (const result of chunk) {
                    if (result.kind === "cmd-status" && result.status !== Status.Success) {
                        refused ??= result;
                    } else if (result.kind === "cmd-response") {
                        response = result.data;
                    }
                }
            }
        });
        if (refused !== undefined) {
            throw classifyCommandStatus(endpointId, clusterId, commandId, refused);
        }
        return response === undefined ? null : normalizeValue(response);
    }

    describe(endpointId: EndpointId): EndpointShape {
        const { nodeId, peer, endpoint } = this.#resolve(endpointId);
        const behaviors = Object.values(endpoint.behaviors.supported).filter(ClusterBehavior.is);
        const clusters = behaviors.map((behavior): ClusterState => {
            const state = endpoint.stateOf(behavior.id);
            const attributes: AttributeState[] = [];
            // @matter/types 0.18.0: `ClusterType.attributes()` leaves the global attributes out of the cluster.
            for (const [name, attribute] of Object.entries(behavior.cluster.attributes ?? {})) {
                const value = state[name];
                // @matter/node 0.18.0: reading synthesizes the default of a mandatory attribute, even one that the
                // AttributeList of the peer omits, so only an optional attribute that was not reported has no value.
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
        const parent = endpoint.owner;
        return {
            // The root of the node is not exposed, so what hangs from it has no parent to name.
            parentId: parent === undefined || parent === peer ? null : endpointIdOf(nodeId, parent),
            deviceType: endpoint.type.deviceType,
            clusters,
        };
    }

    // Each rule is read from the SDK as the change arrives.
    #report(change: ChangeNotificationService.Change): void {
        // Matter events are not reported: the contract has no place for them yet.
        if (change.kind !== "update" || !ClusterBehavior.is(change.behavior)) {
            return;
        }
        const { endpoint, behavior, properties } = change;
        // @matter/node 0.18.0: `ownerOfType` compares only the device type, which the root of the controller shares
        // with that of a peer.
        const peer = endpoint.ownerOfType(ClientNode.RootEndpoint);
        if (!(peer instanceof ClientNode) || peer.lifecycle.isGone || !isExposed(endpoint)) {
            return;
        }
        const nodeId = nodeIdOf(peer);
        if (nodeId === undefined) {
            return;
        }
        const endpointId = endpointIdOf(nodeId, endpoint);
        const attributes = behavior.cluster.attributes ?? {};
        const state = endpoint.stateOf(behavior.id);
        // @matter/node 0.18.0: a change without `properties` is about all of them, and one can name what is not in the
        // cluster, such as a global attribute, or an optional attribute left without a value when the peer drops it.
        for (const name of properties ?? Object.keys(attributes)) {
            const attribute = attributes[name];
            const value = state[name];
            if (attribute !== undefined && value !== undefined) {
                this.#bus.emit("$endpoint:attribute-changed", {
                    endpointId,
                    clusterId: behavior.cluster.id,
                    attributeId: attribute.id,
                    value: normalizeValue(value),
                });
            }
        }
    }

    // Only the abort of this request tells that it timed out, which @matter/main 0.18.0 throws in several shapes. The
    // abort comes 5 s after the limit, which leaves time to answer to a sleeping device that wakes at the end of its
    // wait; at the limit itself, it would fire first and the device would never fail as asleep (ADR 0003).
    async #limited<T>(endpointId: EndpointId, clusterId: number, run: (limits: Limited) => Promise<T>): Promise<T> {
        const abort = AbortSignal.timeout(this.#limit + Seconds(5));
        try {
            return await run({ abort, icdAwaitTimeout: this.#limit });
        } catch (error) {
            throw classifyInteractionError(endpointId, clusterId, error, abort.aborted);
        }
    }

    #resolve(endpointId: EndpointId): PeerEndpoint {
        const resolved = endpointOf(this.#controller, endpointId);
        if (resolved === undefined) {
            throw new EndpointNotFoundError(endpointId);
        }
        return resolved;
    }
}
