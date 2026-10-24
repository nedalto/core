# 0004. Component lifecycle

Status: Accepted

## Context

The hub owns long-lived resources: its log files, a SQLite connection, the Matter node and its sockets, and the HTTP server.
It runs as a service, which a supervisor such as systemd stops with `SIGTERM` and expects to exit within a timeout.
Only `apps/hub` starts and stops components.

## Decision

Every component implements `Lifecycle` (`packages/contract/src/common/lifecycle.ts`):

- `start()` is called once.
  If it throws, the instance is unusable.
- `stop()` may be called at any time, also before `start()` or after a failed one, and then does nothing.
- A stopped instance is not started again.

The hub starts components in order and stops them in reverse, the log files last, so that everything else can log on the way down.
When a start fails, the hub logs it, stops what had started and exits with `1`; ending the process is what releases whatever the failed start had acquired.

The signal handlers are installed before `start()`.
A signal during the start waits for it to finish and then stops; a second signal does nothing.
The process always ends with an explicit `process.exit`, `0` after a stop.

## Alternatives

- **Restartable, idempotent components**: a second `start()` would have to wait for one in progress, and a failed one would have to release what it had acquired, in every component; no caller needs either.
- **A guard that makes `start()` return when already started**: it covers only a second call after a successful start, which no caller makes; after a failed start it acquires everything again, and two concurrent calls both pass it.
- **Installing the signal handlers once the hub is ready**: until then a signal has Node's default effect, which ends the process at once, so a stop during a start of several seconds, or one sent as soon as the ready line appears, would skip the orderly stop.
- **Letting the process end when the event loop empties**: a handle left open by a dependency would keep it running until the supervisor kills it.

## Consequences

A failed start may leave resources open until the process exits, such as the SQLite connection or the SDK's node; tests, which do not exit, are where such a leak would show.
`process.exit` also hides a handle a component forgot to close.
Revisit if a component has to restart inside a running hub.
