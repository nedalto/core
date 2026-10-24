# 0002. Authentication in the WebSocket handshake

Status: Accepted

## Context

The API grants full control of the home, so every connection needs a secret.
Clients include web apps, and the `WebSocket` of a browser cannot set headers: the only parts of the handshake it controls are the URL and the list of subprotocols.

## Decision

A client offers the token as a WebSocket subprotocol and declares the protocol version in `?v=`.
The hub compares the token in constant time, always accepts the upgrade, and on a wrong handshake closes at once, before processing any message, with `4401` for the token or `4426` for the version.
It selects one of the offered subprotocols even when the token is wrong, because a client fails a handshake whose response selects none, and would then see `1006` instead of the close code.

The exact rules are in [the protocol](../protocol.md#handshake).

## Alternatives

- **An `Authorization` header**: browsers cannot send it on a WebSocket.
- **The token in the query string**: URLs end up in the logs of proxies and servers and in browser history.
- **Authenticate with the first message**: it leaves an open connection that is not yet authenticated, whose messages have to be parsed to be refused, and a state every handler has to rule out; with the subprotocol nothing is processed before the token is checked.
- **Refuse the upgrade with HTTP `401`**: the `WebSocket` of a browser does not expose the status, so a client could not tell a wrong token from a network failure.

## Consequences

The token must be a valid subprotocol, an RFC 7230 token, so the hub refuses to start with one that is not, naming the variable.
Failures of the handshake are close codes, not JSON-RPC errors, so they need no error class.
