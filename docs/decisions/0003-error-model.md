# 0003. Error model

Status: Accepted

## Context

Errors cross package boundaries inside the hub and reach clients as JSON-RPC errors.
A client needs to branch on what failed and act on it; a person needs to read it; the operator needs the cause.
JSON-RPC 2.0 defines its own codes for errors of the protocol and leaves -32000 to -32099 to the server.

## Decision

The contract defines six base classes, each with a stable `code`: `VALIDATION_ERROR`, `NOT_FOUND_ERROR`, `CONFLICT_ERROR`, `INTEGRATION_ERROR`, `UNREACHABLE_ERROR` and `INTERNAL_ERROR`.
A subclass exists if code catches it by class, or if it fixes the shape of `data` for a case the client can act on, or for a family of such cases of one operation (`EndpointNotFoundError` with `endpointId`, `CommissioningFailedError` with `reason`).
A failure with no such case is the base class with its `cause`.
Cases that share a class are told apart with `data.reason` in kebab-case, which names what the hub knows rather than what it guesses (`passcode-rejected`, not `wrong-passcode`).
`data` keys are named after the entity, as in events (`nodeId`).

On the wire, `VALIDATION_ERROR` is `-32602` and any other error of the hub is `-32000`, with the code in `data.code`, which is what a client branches on.
`message` is for people, `INTERNAL_ERROR` always says `"Internal error"`, and the cause never leaves the hub.
Failures of the handshake are close codes ([0002](0002-authentication-in-the-websocket-handshake.md)).

The operator reads the cause in `hub.log`.
The failure of a request is logged once, where it is translated into the response, and only if it is unexpected or the SDK or a device decided it.
An unexpected one goes at error, the base `IntegrationError`, which still has to be classified, at warn, and any other error with a `cause` or the code `INTEGRATION_ERROR` at info.
A `VALIDATION_ERROR`, whose cause is only the decoder of the input, and the checks of the hub itself are not logged.
Where an error is produced, only what the client will never see is logged: an error that is swallowed, a second failure that would be lost, or work that does not come from a request.

What each code means for a client is in [the protocol](../protocol.md#errors).

## Alternatives

- **A JSON-RPC code per error, from the server range**: a number carries no meaning a client can read, and a hundred codes would have to be allocated and kept stable; `-32602` stays for validation because JSON-RPC defines it.
- **A class per failure**: a class per case costs a type, its tests and its documentation, and gives the client nothing that `data.reason` does not; one class holds the cases of an operation.

## Consequences

A new case is usually a new `reason` of an existing class, which is additive for clients.
A client branches on `data.code` first and on `data.reason` where it needs more.
