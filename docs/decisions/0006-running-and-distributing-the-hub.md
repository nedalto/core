# 0006. Running and distributing the hub

Status: Accepted

## Context

The hub is a TypeScript monorepo whose packages are private and exist only to be composed by `apps/hub`.
Node 26 runs TypeScript sources directly.
An installation needs a command that a service unit can name.

## Decision

In development and in the tests, Node runs the sources, and `tsc` only type-checks.

To distribute it, rolldown builds `apps/hub` into `apps/hub/dist` (`apps/hub/rolldown.config.ts`):

- The workspace packages are compiled in, and every other import stays external.
- The generated `package.json` declares the `nedalto-hub` command and the dependencies of the workspace packages, read from their manifests; the build fails if two ask for different ranges of one dependency.
- `packages/matter/src/sdk-config.ts` is a chunk of its own, which `main.js` imports first, and the build fails if it holds anything else.
- That directory is packed as an npm tarball and installed with `npm install --global`; CI runs the end-to-end suite against the installed command.

## Alternatives

- **Publish each package to npm**: six packages to version and release besides the hub, for APIs that are internal.
- **Compile with `tsc` and ship the output**: the workspace packages would still have to be resolvable at run time, which means publishing them or shipping a `node_modules` tree.
- **Bundle the dependencies too**: one file, but updates and audits of the dependencies would no longer go through npm, and the SDK's optional platform dependencies would not resolve as npm intends.

## Consequences

`sdk-config` has to be its own chunk because, within one module, imports are evaluated before its body: inlined, the SDK would initialize before the assignments that configure it, and it rejects them once initialized.
A missing dependency in the generated manifest shows in CI, where the installed command runs outside the workspace's `node_modules`.
