import "./sdk-config.ts";
import type { BasicInformation } from "@matter/main/clusters/basic-information";

import { InternalError } from "@nedalto/contract/common/errors.ts";

/** The Basic Information attributes that announce the version of the hub on the fabric. */
export type VersionAttributes = Readonly<
    Pick<BasicInformation.Attributes, "softwareVersion" | "softwareVersionString">
>;

const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMPONENT_LIMIT = 1000;

/**
 * The attributes for the semantic `version`: `softwareVersionString` is `version` as given, and `softwareVersion`,
 * a uint32, is major × 1 000 000 + minor × 1 000 + patch, so that a later release gives a larger number while each
 * component stays below 1000. A pre-release or build suffix does not count in the number. Throws `InternalError` for
 * any other `version`, and for 0.0.0.
 */
export function versionAttributesOf(version: string): VersionAttributes {
    const [major = 0, minor = 0, patch = 0] = SEMANTIC_VERSION.exec(version)?.slice(1, 4).map(Number) ?? [];
    const softwareVersion = major * COMPONENT_LIMIT ** 2 + minor * COMPONENT_LIMIT + patch;
    // @matter/node 0.18.0: the SDK takes a zero as unset and announces development values instead.
    if (softwareVersion === 0 || [major, minor, patch].some((component) => component >= COMPONENT_LIMIT)) {
        throw new InternalError(`Version ${version} has no Matter software version`);
    }
    return { softwareVersion, softwareVersionString: version };
}
