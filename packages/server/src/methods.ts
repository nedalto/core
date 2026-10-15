import type { MethodMap } from "@nedalto/contract/server/types.ts";

/** The one method the transport answers itself instead of the dispatcher. */
export const SUBSCRIBE_METHOD = "hub.subscribe" satisfies keyof MethodMap;

/** A handler per method of the contract but the subscription, each answering what the contract says. */
export type HandlerTable = {
    readonly [Method in Exclude<keyof MethodMap, typeof SUBSCRIBE_METHOD>]: (
        params: unknown,
    ) => MethodMap[Method]["result"] | Promise<MethodMap[Method]["result"]>;
};
