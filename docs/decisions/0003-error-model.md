# 0003. Error model

Status: Accepted

## Context

Errors cross package boundaries inside the hub and reach clients as JSON-RPC errors.
A client needs to branch on what failed and act on it; a person needs to read it; the operator needs the cause.
JSON-RPC 2.0 defines its own codes for errors of the protocol and leaves -32000 to -32099 to the server.

## Decision

The contract defines six base classes, each with a stable `code`: `VALIDATION_ERROR`, `NOT_FOUND_ERROR`, `CONFLICT_ERROR`, `INTEGRATION_ERROR`, `UNREACHABLE_ERROR` and `INTERNAL_ERROR`.
A subclass exists only if code catches it by class or it gives the client a case it can act on; otherwise the base class is reused and cases are told apart with `data.reason` in kebab-case.
`data` keys are named after the entity, as in events (`nodeId`).

On the wire, `VALIDATION_ERROR` is `-32602` and any other error of the hub is `-32000`, with the code in `data.code`, which is what a client branches on.
`message` is for people, `INTERNAL_ERROR` always says `"Internal error"`, and the cause never leaves the hub.
Failures of the handshake are close codes ([0002](0002-authentication-in-the-websocket-handshake.md)).

What each code means for a client is in [the protocol](../protocol.md#errors).

## Alternatives

- **A JSON-RPC code per error, from the server range**: a number carries no meaning a client can read, and a hundred codes would have to be allocated and kept stable; `-32602` stays for validation because JSON-RPC defines it.
- **A class per failure**: a class nobody catches costs a type, its tests and its documentation, and gives the client nothing that `data.reason` does not.

## Consequences

A new case is usually a new `reason`, which is additive for clients.
A client branches on `data.code` first and on `data.reason` where it needs more.
