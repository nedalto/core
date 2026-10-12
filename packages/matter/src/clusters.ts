/* oxlint-disable typescript/no-deprecated -- @matter/types 0.17.9 deprecates one overload of the `ClusterType` function, and oxlint reports it on every use of the namespace of the same name; nothing deprecated is used here. */
import "./sdk-config.ts";
import { ClusterModel, Matter } from "@matter/main/model";
import type { Specifier } from "@matter/main/protocol";
import { ClusterId, ClusterType } from "@matter/main/types";

/** An attribute of a cluster of the Matter specification, with the cluster that defines it. */
export interface SpecAttribute {
    readonly cluster: Specifier.ClusterLike;
    readonly attribute: ClusterType.Attribute;
}

/** A command of a cluster of the Matter specification, with the cluster that defines it. */
export interface SpecCommand {
    readonly cluster: Specifier.ClusterLike;
    readonly command: ClusterType.Command;
}

// @matter/types 0.17.9: `ClusterType.attributes()` and `commands()` leave out what the specification disallows
// on the cluster, the global attributes and the responses, which share the id of the request they answer. What
// the descriptor holds is what the SDK can build a request from.
function describeCluster(clusterId: number): Specifier.ClusterLike | undefined {
    const model = Matter.get(ClusterModel, clusterId);
    if (model === undefined) {
        return undefined;
    }
    return {
        id: ClusterId(clusterId),
        name: model.name,
        attributes: ClusterType.attributes(model),
        commands: ClusterType.commands(model),
    };
}

/** The attribute of the specification with that id, or `undefined` when its cluster or the attribute is not in it. */
export function findSpecAttribute(clusterId: number, attributeId: number): SpecAttribute | undefined {
    const cluster = describeCluster(clusterId);
    const attribute = Object.values(cluster?.attributes ?? {}).find(({ id }) => id === attributeId);
    return cluster !== undefined && attribute !== undefined ? { cluster, attribute } : undefined;
}

/** The command of the specification with that id, or `undefined` when its cluster or the command is not in it. */
export function findSpecCommand(clusterId: number, commandId: number): SpecCommand | undefined {
    const cluster = describeCluster(clusterId);
    const command = Object.values(cluster?.commands ?? {}).find(({ id }) => id === commandId);
    return cluster !== undefined && command !== undefined ? { cluster, command } : undefined;
}
