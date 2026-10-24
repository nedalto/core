# 0007. Matter controller on the node API

Status: Accepted

## Context

The hub is a Matter controller: it commissions devices, finds them again on the network and follows their state.
matter.js, the JavaScript Matter SDK, offers two ways to build one: the node API of `@matter/main`, where a node is a `ServerNode` composed of behaviors, and the legacy `CommissioningController` API.
The SDK is not yet at 1.0, and minor versions change its API.

## Decision

The controller is a `ServerNode` with `ControllerBehavior`, with commissioning disabled so that the hub never advertises itself as a commissionable device (`packages/matter/src/controller.ts`).

The SDK stays inside `packages/matter`:

- What the package exports uses contract types, and its gateways translate SDK errors into contract errors.
- `sdk-config.ts` keeps the SDK from reading `MATTER_*` variables, command-line flags or a config file, and from handling signals.
- oxlint rejects `@matter/*` imports anywhere else.

`@matter/main` is pinned to an exact version, and every comment about SDK behavior cites the version it was checked against.

## Alternatives

- **The legacy `CommissioningController`**: matter.js labels it legacy, so building on it would mean migrating later.
- **A Matter controller in a separate process**, such as a Matter server spoken to over WebSocket: a second process to supervise, a second protocol to translate and its data model between the hub and the devices, where in process the hub reads node state and errors directly.

## Consequences

Updating the SDK means rechecking every comment that cites its version, as the `dependency-update` skill requires.
The pinned version keeps those comments true between updates.
