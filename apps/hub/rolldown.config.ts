import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "rolldown";

interface Manifest {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    readonly author?: string;
    readonly license?: string;
    readonly repository?: unknown;
    readonly engines?: Record<string, string>;
    readonly dependencies?: Record<string, string>;
}

const WORKSPACE_SCOPE = "@nedalto/";

// Matches the module by path, so that renaming or moving it fails `verifySdkIsolation` instead of passing unnoticed.
const SDK_CONFIG_MODULE = /packages\/matter\/src\/sdk-config\.ts$/;
const SDK_CONFIG_CHUNK = "sdk-config";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = join(here, "..", "..");

const readManifest = async (directory: string): Promise<Manifest> =>
    JSON.parse(await readFile(join(directory, "package.json"), "utf8"));

const isWorkspacePackage = (id: string): boolean => id.startsWith(WORKSPACE_SCOPE);

/** The dependencies of the workspace packages the hub depends on, minus those packages themselves. */
async function runtimeDependencies(hub: Manifest): Promise<Record<string, string>> {
    const collected = new Map<string, string>();

    for (const name of Object.keys(hub.dependencies ?? {}).filter(isWorkspacePackage)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of small files
        const manifest = await readManifest(join(workspace, "packages", name.slice(WORKSPACE_SCOPE.length)));
        for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
            if (isWorkspacePackage(dependency)) {
                continue;
            }
            const seen = collected.get(dependency);
            if (seen !== undefined && seen !== range) {
                throw new Error(`${dependency} is required as ${seen} and as ${range}`);
            }
            collected.set(dependency, range);
        }
    }
    return Object.fromEntries([...collected].toSorted(([a], [b]) => a.localeCompare(b)));
}

/** Emits the `package.json` and `LICENSE` that make the output directory an installable package. */
const distributable = (): Plugin => ({
    name: "nedalto-distributable",
    async generateBundle(_options, bundle) {
        const hub = await readManifest(here);
        // Read before emitting the two files below, which npm packs on its own.
        const files = Object.keys(bundle).toSorted();

        this.emitFile({ type: "asset", fileName: "LICENSE", source: await readFile(join(workspace, "LICENSE")) });
        this.emitFile({
            type: "asset",
            fileName: "package.json",
            source: `${JSON.stringify(
                {
                    name: hub.name,
                    version: hub.version,
                    description: hub.description,
                    author: hub.author,
                    license: hub.license,
                    repository: hub.repository,
                    type: "module",
                    engines: hub.engines,
                    bin: { "nedalto-hub": "main.js" },
                    files,
                    dependencies: await runtimeDependencies(hub),
                },
                null,
                2,
            )}\n`,
        });
    },
});

/** Fails the build unless `sdk-config.ts` came out as a chunk of its own, which is the only way it runs before the SDK. */
const verifySdkIsolation = (): Plugin => ({
    name: "nedalto-verify-sdk-isolation",
    generateBundle(_options, bundle) {
        const chunk = Object.values(bundle).find(
            (output) => output.type === "chunk" && output.name === SDK_CONFIG_CHUNK,
        );
        if (chunk?.type !== "chunk") {
            this.error(`no ${SDK_CONFIG_CHUNK} chunk was emitted: ${SDK_CONFIG_MODULE} matched no module`);
        }
        const [only, ...others] = chunk.moduleIds;
        if (only === undefined || !SDK_CONFIG_MODULE.test(only) || others.length > 0) {
            this.error(
                `the ${SDK_CONFIG_CHUNK} chunk must hold that module alone, and holds: ${chunk.moduleIds.join(", ")}`,
            );
        }
    },
});

export default defineConfig({
    input: join(here, "src", "main.ts"),
    platform: "node",
    plugins: [distributable(), verifySdkIsolation()],
    // Only what is bundled is listed, so a new third-party dependency stays external without being mentioned.
    external: (id) => !(isWorkspacePackage(id) || id.startsWith(".") || id.startsWith("/")),
    output: {
        format: "esm",
        dir: join(here, "dist"),
        cleanDir: true,
        entryFileNames: "main.js",
        chunkFileNames: "[name].js",
        banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node" : ""),
        comments: false,
        sourcemap: true,
        sourcemapExcludeSources: true,
        // Inside main.js its assignments would run after the SDK, which refuses them; as a chunk, main.js imports it first.
        // See `docs/decisions/0006-running-and-distributing-the-hub.md`.
        codeSplitting: { groups: [{ name: SDK_CONFIG_CHUNK, test: SDK_CONFIG_MODULE }] },
    },
});
