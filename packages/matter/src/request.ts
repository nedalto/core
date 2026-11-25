import "./sdk-config.ts";
import type { ClusterBehavior } from "@matter/main/node";
import { type ClientRead, Invoke, Read, Write } from "@matter/main/protocol";
import {
    AttributeId,
    ClusterId,
    EndpointNumber,
    FabricIndex,
    TlvCodec,
    TlvOfModel,
    type TlvSchema,
    type TlvStream,
    TlvType,
} from "@matter/main/types";

import { ValidationError } from "@nedalto/contract/common/errors.ts";
import type { AttributeValue } from "@nedalto/contract/endpoint/types.ts";

import { denormalizeValue } from "./normalize.ts";

// The cluster of a behavior of a peer endpoint, as the gateway finds it, and its attributes and commands.
type Cluster = ClusterBehavior.Type["cluster"];
type Attribute = NonNullable<Cluster["attributes"]>[string];
type Command = NonNullable<Cluster["commands"]>[string];

/** The request to read one attribute, which always brings its value. */
export function readRequest(endpoint: number, clusterId: number, attributeId: number): ClientRead {
    return {
        ...Read({
            attributes: [
                {
                    endpointId: EndpointNumber(endpoint),
                    clusterId: ClusterId(clusterId),
                    attributeId: AttributeId(attributeId),
                },
            ],
        }),
        // @matter/node 0.18.0: `ClientNodeInteraction.read` documents this as the way to always receive the
        // values; otherwise it adds the versions it has cached and the device leaves out the clusters that did not
        // change. `injectVersionFilters` only adds them to the clusters that `ReadScope` finds relevant, which
        // excludes a path that names one attribute, as this one does.
        includeKnownVersions: true,
    };
}

// What a request carries of `value`: what `schema` encodes of it, decoded back.
const carriedOf = (schema: TlvSchema<unknown>, value: unknown): unknown => schema.decodeTlv(schema.encodeTlv(value));

const invalid = (path: "value" | "args", message: string, cause?: unknown): ValidationError =>
    new ValidationError("Invalid input", { cause, issues: [{ path, message }] });

// Rejects a number in an integer field that the SDK would send changed: with decimals, which it drops, or outside the
// safe range, which JSON has already rounded.
function assertIntegerFields(streams: readonly (TlvStream | undefined)[], path: "value" | "args"): void {
    for (const { typeLength, value } of streams.flatMap((stream) => stream ?? [])) {
        const integer = typeLength.type === TlvType.SignedInt || typeLength.type === TlvType.UnsignedInt;
        if (!integer || typeof value !== "number") {
            continue;
        }
        // @matter/types 0.18.0: the schema of an integer accepts a number with decimals, which the request keeps as
        // given until it is written, without the decimals (https://github.com/matter-js/matter.js/issues/5036).
        if (!Number.isInteger(value)) {
            throw invalid(path, `${path} holds ${value} for an integer field`);
        }
        // Every integer literal beyond the safe range parses to a number of magnitude 2^53 or more.
        if (!Number.isSafeInteger(value)) {
            throw invalid(path, `${path} holds an integer outside the safe range, which goes as { "$integer": "…" }`);
        }
    }
}

const isInteger = (value: number | bigint): boolean => typeof value === "bigint" || Number.isInteger(value);

// Where `carried` misses or changes what `given` holds. An integer must arrive as it is, and a number with decimals
// keeps the precision of its field.
function lostIn(given: unknown, carried: unknown, at: string): string | undefined {
    if (typeof given === "number" || typeof given === "bigint") {
        if (typeof carried !== "number" && typeof carried !== "bigint") {
            return at;
        }
        return isInteger(given) && isInteger(carried) && BigInt(given) !== BigInt(carried) ? at : undefined;
    }
    if (Array.isArray(given)) {
        if (!Array.isArray(carried) || carried.length !== given.length) {
            return at;
        }
        for (const [index, item] of given.entries()) {
            const lost = lostIn(item, carried[index], `${at}[${index}]`);
            if (lost !== undefined) {
                return lost;
            }
        }
        return undefined;
    }
    if (typeof given === "object" && given !== null) {
        if (typeof carried !== "object" || carried === null) {
            return at;
        }
        const fields = new Map<string, unknown>(Object.entries(carried));
        for (const [key, field] of Object.entries(given)) {
            const lost = fields.has(key) ? lostIn(field, fields.get(key), `${at}.${key}`) : `${at}.${key}`;
            if (lost !== undefined) {
                return lost;
            }
        }
        return undefined;
    }
    return given === carried ? undefined : at;
}

// @matter/types 0.18.0: a struct passes its check with fields it does not have and leaves them out of the request, and
// a bitmap has no check of its own: it takes from an object only its flags, so a number goes as no flag at all, and the
// number of a field wider than one bit as it is, into the bits of the next fields (`validate` in `TlvObject.js`,
// `encodeInternal` in `BitmapSchema.js`).
function assertCarried(given: unknown, carried: unknown, path: "value" | "args"): void {
    const lost = lostIn(given, carried, path);
    if (lost !== undefined) {
        throw invalid(path, `${lost} would not reach the device as given`);
    }
}

// The device sets the fabric index of each entry itself (ADR 0003). @matter/types 0.18.0: the schema of the entry
// requires it and the request leaves it out (`forWriteInteraction` in `TlvObject.js`); `FabricIndex.OMIT_FABRIC` passes
// the check and is never sent (`FabricIndex.js`).
function withFabricIndex(value: unknown, fabricIndexOnPeer: FabricIndex | undefined): unknown {
    if (!Array.isArray(value)) {
        return value;
    }
    return value.map((entry: unknown, index) => {
        if (typeof entry !== "object" || entry === null) {
            return entry;
        }
        if (!("fabricIndex" in entry)) {
            return { ...entry, fabricIndex: FabricIndex.OMIT_FABRIC };
        }
        if (entry.fabricIndex !== fabricIndexOnPeer) {
            const known = fabricIndexOnPeer === undefined ? "" : ` to ${fabricIndexOnPeer}`;
            throw invalid("value", `value[${index}].fabricIndex is set by the device${known}: leave it out`);
        }
        return entry;
    });
}

/**
 * The request to write `value` to `attribute`, with the value converted for the SDK.
 * An entry of a fabric-scoped list leaves out its `fabricIndex`, which the device sets, or gives the one that the
 * device gave the fabric of the hub: `fabricIndexOnPeer`, `undefined` while it is not known.
 * Throws `ValidationError` with the path `value` for a value that does not fit the attribute or would not reach the
 * device as given.
 * See `docs/decisions/0003-endpoint-gateway-on-raw-interactions.md` and `0004-integers-and-bytes-of-device-values.md`.
 */
export function writeRequest(
    endpoint: number,
    cluster: Cluster,
    attribute: Attribute,
    value: AttributeValue,
    fabricIndexOnPeer: FabricIndex | undefined,
): Write {
    const given = denormalizeValue(value, "value");
    const sdkValue = attribute.schema.fabricScoped ? withFabricIndex(given, fabricIndexOnPeer) : given;
    let request: Write;
    let carried: unknown;
    try {
        const schema = TlvOfModel(attribute);
        // @matter/protocol 0.18.0: `Write()` does not check a value against the type of the attribute, so
        // that a string for a number only fails once the request is sent, and then not as a validation error.
        schema.validate(sdkValue);
        carried = carriedOf(schema, sdkValue);
        request = Write(
            // @matter/protocol 0.18.0: by default a list goes as its replacement and then entry by entry, which the
            // device applies one by one, so an entry it refuses leaves the others written; whole, it applies or refuses
            // the list as one, and only one too large for a message is still split (`InteractionMessenger.js`).
            { chunkLists: false },
            Write.Attribute({ endpoint: EndpointNumber(endpoint), cluster, attributes: attribute, value: sdkValue }),
        );
    } catch (error) {
        throw invalid("value", "value does not fit the type of the attribute", error);
    }
    assertIntegerFields(
        request.writeRequests.map(({ data }) => data),
        "value",
    );
    assertCarried(given, carried, "value");
    return request;
}

// @matter/types 0.18.0 sizes the length of a text by its UTF-16 units and writes its UTF-8 bytes, so a text of up to
// 255 units and more bytes goes with a length that does not fit (`TlvString.js`). Remove with the update to 0.18.1,
// which fixes it (https://github.com/matter-js/matter.js/pull/4995). Only a command takes a text that long.
function assertTextFields(streams: readonly (TlvStream | undefined)[], path: "args"): void {
    for (const { typeLength, value } of streams.flatMap((stream) => stream ?? [])) {
        if (typeLength.type !== TlvType.Utf8String || typeof value !== "string") {
            continue;
        }
        const bytes = Buffer.byteLength(value);
        if (TlvCodec.getUIntTlvLength(bytes) !== typeLength.length) {
            throw invalid(
                path,
                `${path} holds a text of ${bytes} bytes in ${value.length} characters, which the SDK cannot send`,
            );
        }
    }
}

/**
 * The request to invoke `command` with `args`, converted for the SDK.
 * Throws `ValidationError` with the path `args` for arguments that do not fit the fields of the command or would not
 * reach the device as given.
 * See `docs/decisions/0004-integers-and-bytes-of-device-values.md`.
 */
export function invokeRequest(endpoint: number, cluster: Cluster, command: Command, args?: AttributeValue): Invoke {
    const fields = args === undefined ? undefined : denormalizeValue(args, "args");
    let request: Invoke;
    let carried: unknown;
    try {
        request = Invoke({ commands: [{ endpoint: EndpointNumber(endpoint), cluster, command, fields }] });
        carried = fields === undefined ? undefined : carriedOf(TlvOfModel(command), fields);
    } catch (error) {
        throw invalid("args", "args do not fit the fields of the command", error);
    }
    const streams = request.invokeRequests.map(({ commandFields }) => commandFields);
    assertIntegerFields(streams, "args");
    assertTextFields(streams, "args");
    assertCarried(fields, carried, "args");
    return request;
}
