# 0003. Endpoint gateway on raw interactions

Status: Accepted

## Context

The hub reads and writes attributes of the endpoints of its devices, invokes their commands, describes them and follows the changes of their attributes.
@matter/main 0.18.0 offers two ways to talk to a peer: the behaviors of its endpoints (`setStateOf`, `commandsOf`), and raw interactions on `node.interaction` (`Read`, `Write`, `Invoke`), which the behaviors are built on.

A device may not answer.
On its own, the SDK waits up to 90 s to reach a device it has no session with, such as one that is off when the hub starts.
For one that stops answering in a session, it waits until it gives up retransmitting: about 40 s on Wi-Fi and 60 s on Thread, with the session intervals that connectedhomeip gives devices by default (`MRP.js` and `NetworkProfile.js` of `@matter/protocol` 0.18.0).
A device that sleeps to save battery, an ICD with a long idle time, answers only when it wakes, which may be minutes later.
And no protocol tells a request that never arrived from one that was applied and whose answer was lost: Matter has no request id, and only the device, through its subscription, says how it was left.

## Decision

`packages/matter/src/gateways/endpoint.ts` uses raw interactions for `read`, `write` and `invoke`, and the state the SDK keeps for `describe`, which does not contact the device.

**What it addresses.**
An endpoint is exposed when it is not the root of its node (endpoint 0, which holds the fabrics and can remove them), the SDK has its structure, and it is not being deleted: the same rule as the endpoints the node gateway lists (`isExposed` in `packages/matter/src/addressing.ts`).
Any other is an `EndpointNotFoundError`.
The cluster is the one the endpoint has (`behaviors.forCluster`), so a cluster the endpoint lacks is rejected without contacting the device, also when the device is off.

**The fabric index.**
Each entry of a fabric-scoped list, such as `Binding.binding`, carries the index of the fabric it belongs to, and each device numbers the fabrics in its own table.
On a write the device sets the index of each entry itself, and the SDK leaves it out of the request (`forWriteInteraction` in `TlvObject.js` of `@matter/types` 0.18.0), but its type check requires it.
A client leaves it out of an entry, and the entry goes with `FabricIndex.OMIT_FABRIC`, which passes the check and is never sent; or it gives the index that the device gave the hub's fabric, as a read returns it (`fabricIndexOnPeer` of `CommissioningClient`).
Any other index is a `ValidationError`.

**How it writes a list.**
A list goes whole (`chunkLists: false`), so that the device applies or refuses it as one.

**How long it waits.**
A request to a sleeping device waits at most 10 s, the limit, for it to wake: the SDK receives the limit as `icdAwaitTimeout`, and fails the request as asleep when it ends.
Every request ends at the latest 5 s later, at 15 s, when the signal that the SDK receives as `abort` fires, and one still unanswered then is `no-response`, which the gateway tells from its own signal.
The 5 s leave a sleeping device that wakes at the end of its wait time to answer.

**What a client learns when there is no answer.**
`UNREACHABLE_ERROR` means that the target, an endpoint or a node, did not answer, with `data.reason`:

- `asleep`: the device sleeps and did not wake within the wait; the hub held the request and never sent it, so repeating it is safe.
- `no-response`: no answer arrived.
  A write or a command may have been applied, and the changes of attributes tell how the device was left.

**What it reports.**
It reports each change of an attribute value as `$endpoint:attribute-changed`, from the `ChangeNotificationService` of the controller, which also reports the controller's own endpoints: it leaves those out, and the changes of a peer without an address or being deleted, or of an endpoint that is not exposed.

## Alternatives

- **The behaviors of the endpoints**: they accept neither `abort` nor `icdAwaitTimeout`, so a request waits as long as the SDK does, and they report each failure with a different SDK class instead of a status.
- **The clusters of the specification** (`ClusterType` from the global model): it answers whether the specification defines a cluster, not whether the device has it, and leaves vendor clusters out.
- **The index that the hub gives its own fabric** (`peerAddress.fabricIndex`): it is not the device's when another ecosystem commissioned the device first, so the check would reject the index a read returns and accept one that the device replaces.
- **Leaving out or rejecting any fabric index given**: left out, the device would store another index than the one given, without notice; rejected, a list read and written back would fail.
- **Writing a list as `Write()` does by default**, as its replacement and then entry by entry: the device applies them one by one, so one that refuses an entry keeps the others and has lost the entries it had, while the client receives a refusal (checked with @matter/main 0.18.0).
- **The SDK's own waits, shortened**: its connection timeout (`defaultConnectionTimeout`) applies to every operation of the node, and bounds only the wait for a device it has no session with.
- **The abort at the limit itself**: the signal starts before the SDK begins to hold the request, so the abort would always fire first, and a sleeping device would never fail as asleep (checked with @matter/main 0.18.0).
- **A shorter abort**: a false `no-response` is worse than waiting, as a client may repeat a command that is not idempotent.
- **Telling a timeout by the class of the error**: when the abort fires, @matter/main 0.18.0 throws its reason as it is, an `AbortedError` without a cause, or one caused by the reason, depending on the operation and on whether the session was still open.
- **`offline` as the reason**: the hub knows only that no answer arrived, also from a device that is on but slow or busy, and `offline` suggests that the request did not arrive.

## Consequences

A client should prefer idempotent commands and absolute writes where they exist (On and Off over Toggle), so that repeating one after `no-response` is safe, and show the state the changes of attributes report rather than assume the result of a command.
A request may take 15 s to fail, so a client shows at once that it is in progress and, after a few seconds, that the device is slow.

Known limits:

- Matter events, such as the press of a button, are not reported: deciding which to forward, and what to do with the old ones that a device sends again when it subscribes, is left for later.
- A request to a device that sleeps for minutes almost always fails as `asleep`.
  The SDK already holds the request until the device checks in; what is missing is a policy for those devices: no limit on the wait, an accepted answer to the client, and the result as an event.
  A held request lives in memory and is lost if the hub restarts.
- A list too large for one message still goes as its replacement and then entry by entry (`InteractionMessenger.js` of `@matter/protocol` 0.18.0), so a refusal leaves part of it written.
- An attribute that a device takes only inside an atomic write, such as the presets and schedules of a thermostat, is refused outside one (`INVALID_IN_STATE`), and the gateway does not open one.
- A device that disappears without closing its session may stay `connected` until its subscription expires, which may take minutes, and meanwhile each request to it takes up to 15 s to fail.
  Asking for a lower ceiling on the subscription would tell clients sooner, at the cost of more traffic with the devices.
- To a Thread device with the default session intervals of connectedhomeip, which @matter/protocol 0.18.0 lengthens by 1.5 s, the abort leaves room for three or four of the five transmissions of a request: one whose first three are lost fails as `no-response`, and room for all five would take about 30 s for every request that goes unanswered.
- Vendor clusters can only be read: `@matter/node` 0.18.0 models the attributes and commands of a cluster it does not know as `any` (`PeerBehavior.js`), whose TLV schema accepts only a raw `TlvStream`, so a write or a command to one is a `VALIDATION_ERROR` that says the value does not fit.
- The waits of Wi-Fi and Thread devices are computed, not measured with real devices, and the check-in of a real sleeping device has not been exercised either.
