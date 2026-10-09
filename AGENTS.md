# Nedalto

Local-first smart home hub that speaks only Matter and exposes a JSON-RPC 2.0 API over WebSocket.

## Packages

TypeScript monorepo with npm workspaces.
Packages import only `@nedalto/contract` subpaths (enforced by oxlint); `apps/hub` composes them.

- `packages/contract`: types, schemas and ports shared by all packages.
- `packages/config`: loads and validates the JSON configuration file and resolves environment variables.
- `packages/logger`: opens the log streams (application and Matter) and writes the application log.
- `packages/database`: SQLite persistence with `node:sqlite`: queries and writes.
- `packages/matter`: Matter controller: commissioning and talking to devices.
- `packages/server`: the client API: JSON-RPC over WebSocket, handlers, use cases and views.
- `apps/hub`: the executable; composes the packages and owns the event bus.

## Verification

Node 26 and npm 11.
Node runs the TypeScript sources directly: there is no build step, `tsc` only type-checks.

A change is done when these pass (CI runs the same):

    npm run format:check
    npm run lint
    npm run --workspaces type
    npm run --workspaces test

`npm run format` and `npm run lint:fix` fix what they can.

The end-to-end suite runs separately and needs IPv6, which Matter requires:

    npm run --workspace=@nedalto/hub e2e

## Documentation

- Why code is the way it is: a short comment next to it.
- An invariant: a test or a type.
  If it cannot be checked, do not state it.
- A cross-cutting decision with alternatives: an ADR in `docs/decisions/`, copied from `0000-template.md`.
- What clients can rely on (methods, events, errors, ordering): `docs/protocol.md`.
- What operators configure (the configuration file, environment variables): `docs/configuration.md`.

## Design

- Simplest thing first.
  An abstraction, layer, port or package must solve a problem that exists today.
- Do not generalize from a single case.
- Validate at the boundaries (client messages, configuration, devices); inside, trust the types.
- Prefer documenting a decision over defensive code for cases that cannot happen.
- Do not add a dependency without asking first.

## Conventions

- Everything in the repository is in English: code, comments, docs, commits and PRs.
- Markdown: one sentence per line, no hard wrapping.
