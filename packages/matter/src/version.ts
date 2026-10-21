import { InternalError } from "@nedalto/contract/common/errors.ts";

const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const COMPONENT_LIMIT = 1000;

/**
 * The Matter `SoftwareVersion`, a uint32, for the semantic `version`: major × 1 000 000 + minor × 1 000 + patch,
 * so that a later release gives a larger number while each component stays below 1000. A pre-release or build
 * suffix does not count. Throws `InternalError` for any other `version`, and for 0.0.0.
 */
export function softwareVersionOf(version: string): number {
    const [major = 0, minor = 0, patch = 0] = SEMANTIC_VERSION.exec(version)?.slice(1, 4).map(Number) ?? [];
    const softwareVersion = major * COMPONENT_LIMIT ** 2 + minor * COMPONENT_LIMIT + patch;
    // @matter/node 0.17.9: the SDK takes a zero as unset and announces development values instead.
    if (softwareVersion === 0 || [major, minor, patch].some((component) => component >= COMPONENT_LIMIT)) {
        throw new InternalError(`Version ${version} has no Matter software version`);
    }
    return softwareVersion;
}
