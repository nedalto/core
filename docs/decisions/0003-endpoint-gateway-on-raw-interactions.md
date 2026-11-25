# 0003. Endpoint gateway on raw interactions

Status: Accepted

## Context

The hub reads and writes attributes of the endpoints of its devices, invokes their commands, describes them and follows the changes of their attributes.
@matter/main 0.18.0 offers two ways to talk to a peer: the behaviors of its endpoints (`setStateOf`, `commandsOf`), and raw interactions on `node.interaction` (`Read`, `Write`, `Invoke`), which the behaviors are built on.

A device may not answer.
On its own, the SDK keeps a request to a device that is off for 90 s, and then fails it with an `AbortedError` that says the device did not answer only in its cause (`PeerUnreachableError`).
A device that sleeps to save battery answers only when it wakes, which may be minutes later.
And no protocol tells a request that never arrived from one that was applied and whose answer was lost: Matter has no request id, and only the device, through its subscription, says how it was left.

## Decision

`packages/matter/src/gateways/endpoint.ts` uses raw interactions for `read`, `write` and `invoke`, and the state the SDK keeps for `describe`, which does not contact the device.

**What it addresses.**
An endpoint is exposed when it is not the root of its node (endpoint 0, which holds the fabrics and can remove them), the SDK has its structure, and it is not being deleted: the same rule as the endpoints the node gateway lists (`isExposed` in `packages/matter/src/addressing.ts`).
Any other is an `EndpointNotFoundError`.
The cluster is the one the endpoint has (`behaviors.forCluster`), not the one the specification defines, so a cluster the endpoint lacks is rejected without contacting the device, also when the device is off.
`packages/matter/src/request.ts` builds the requests that the gateway sends, so that the gateway only checks the ids, resolves, sends and classifies.
It turns the value of a write or a command that does not fit into a `ValidationError`: it checks a value to write against the type of the attribute, because `Write()` does not, and rejects what the SDK would not send as given, such as a number with decimals in an integer field ([matter-js/matter.js#5036](https://github.com/matter-js/matter.js/issues/5036)) or a field that the struct does not have (ADR 0004).
Vendor clusters go through the same path, but only to read: `@matter/node` 0.18.0 models the attributes and commands of a cluster it does not know as `any` (`PeerBehavior.js`), whose TLV schema accepts only a raw `TlvStream`, so a write or a command to one fails the type check.

**The fabric index.**
Each entry of a fabric-scoped list, such as `Binding.binding`, carries the index of the fabric it belongs to.
Each device numbers the fabrics in its own table, so the index of the hub's fabric changes from one device to another, and differs from the one the hub gives its own fabric (`peerAddress.fabricIndex`) when another ecosystem was there first.
On a write the device sets the index of each entry itself, and the SDK leaves it out of the request (`forWriteInteraction` in `TlvObject.js` of `@matter/types` 0.18.0), but its type check requires it.
An entry of a write leaves it out, and goes with `FabricIndex.OMIT_FABRIC`, which passes the check and is never sent; or it gives the index that the device gave the hub's fabric, as a read returns it (`fabricIndexOnPeer` of `CommissioningClient`).
Any other index is a `ValidationError`: the device would store another than the one given.

**How it writes a list.**
A list goes whole, so that the device applies or refuses it as one.
By default `Write()` sends it as its replacement and then entry by entry, which the device applies one by one: one that refuses an entry keeps the others, and has lost the entries it had (checked with @matter/main 0.18.0).

**How long it waits.**
Each interaction carries a limit, 10 s, that the gateway has as a default and tests replace with a shorter one: the SDK receives it as `icdAwaitTimeout`, and the limit plus 5 s, 15 s, as `abort`.
The SDK holds a request to a sleeping device until it wakes, and fails it as asleep when the limit ends; the abort ends the wait for any other device.
The abort always comes later: with both equal, it would always fire first, because the signal starts before the SDK begins to hold the request, and a sleeping device would never fail as asleep (checked with @matter/main 0.18.0).
The 15 s are not shorter because a false `no-response` is worse than waiting: a client may repeat a command that is not idempotent.
They also leave 5 s to answer to a sleeping device that wakes at the end of its wait, and time for the peers that are reconnecting after the hub restarts.
What the user perceives of the wait is up to the client, which shows at once that the request is in progress and, after a few seconds, that the device is slow.
When the abort fires, the SDK throws its reason as it is, an `AbortedError` without a cause, or one caused by the reason, depending on the operation and on whether the session was still open; so the gateway tells that the request timed out from its own signal, not from the error.

**What a client learns when there is no answer.**
`UNREACHABLE_ERROR` means that the target did not answer, with `data.reason`:

- `asleep`: the device sleeps and did not wake within the wait; the hub held the request and never sent it, so repeating it is safe.
- `no-response`: no answer arrived.
  A write or a command may have been applied, and the changes of attributes tell how the device was left.

It is `no-response` and not `offline` because the hub does not know that the device is off: a slow device, one that closes its session or one that answers it is busy end up here too, one that is unplugged stays connected for the SDK until its subscription expires, and `offline` suggests that the request did not arrive.
The code stays `UNREACHABLE_ERROR`, the term Matter uses for a device that does not answer.

**What it returns.**
`invoke` returns the fields of the response of the command, or `null` for one that responds without data.
A `status` among those fields belongs to the command, for the client to interpret; it is not a refusal.
`read` asks with `includeKnownVersions`, which @matter/node 0.18.0 documents as the way to always receive the values.

**What it reports.**
It reports each change of an attribute value as `$endpoint:attribute-changed`, from the `ChangeNotificationService` of the controller, reading at each change whether to: nothing of the controller's own endpoints, of a peer without an address or being deleted, or of an endpoint that is not exposed.

## Alternatives

- **The behaviors of the endpoints**: they accept neither `abort` nor `icdAwaitTimeout`, so a command to a device that is off waits 90 s, and they report each failure with a different SDK class instead of a status.
- **The clusters of the specification** (`ClusterType` from the global model): it answers whether the specification defines a cluster, not whether the device has it, and leaves vendor clusters out.
- **The index that the hub gives its own fabric, in a fabric-scoped entry**: on a device that another ecosystem commissioned first it is not the device's, so the check would reject the index a read returns and accept one that the device replaces.
- **Leaving out any fabric index given**: the device would store another than the one given, without notice.
- **Rejecting any fabric index given**: a list read and written back would fail.
- **Writing a list entry by entry, as the SDK does by default**: the client receives a refusal for a write that the device has partly applied.
- **The abort at the limit itself**: it always fires first, so `asleep` is never reported.
- **Both limits as parameters of the gateway**: a test could pass them in the wrong order, which deriving the abort from the limit rules out.
- **A limit that the controller must pass**: the controller would need to know the wait for a sleeping device and its reason, which belong to the interactions of the gateway; if the limit is ever configured, it will come from the configuration that way.
- **Telling a timeout by the class of the error**: the SDK throws three different shapes for it.
- **A shorter abort**: it would report `no-response` for devices that were about to answer, and a client may then repeat a command that is not idempotent.
- **Reporting whether an unanswered request was applied**: there is no deterministic way to know.

## Consequences

A client should prefer idempotent commands and absolute writes where they exist (On and Off over Toggle), so that repeating one after `no-response` is safe, and show the state the changes of attributes report rather than assume the result of a command.

Known limits:

- Matter events, such as the press of a button, are not reported: deciding which to forward, and what to do with the old ones that a device sends again when it subscribes, is left for later.
- A command to a long idle device that sleeps for minutes almost always fails as `asleep`.
  The SDK already holds the request until the device checks in; what is missing is a policy for those devices: no limit on the wait, an accepted answer to the client, and the result as an event.
  A held request lives in memory and is lost if the hub restarts.
- A list too large for one message still goes as its replacement and then entry by entry (`InteractionMessenger.js` of `@matter/protocol` 0.18.0), so a refusal leaves part of it written; the changes of attributes tell how the device was left.
- An attribute that a device takes only inside an atomic write, such as the presets and schedules of a thermostat, is refused outside one (`INVALID_IN_STATE`), and the gateway does not open one.
- A device that disappears without closing its session stays connected for the SDK until its subscription expires, which may take minutes, and every request to it waits until the abort.
  Asking for a lower ceiling on the subscription would tell clients sooner, at the cost of more traffic with the devices.
- Vendor clusters are read-only until the SDK has their types.
  Meanwhile, a write or a command to one is a `VALIDATION_ERROR` that says the value does not fit the type; which error to give is decided when they can be written.
- The 10 s and 15 s have not been measured with a real Thread device, nor has the check-in of a real long idle device.
