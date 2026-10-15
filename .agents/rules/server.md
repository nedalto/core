---
paths:
  - "packages/server/{src,test}/**/*.ts"
---

# Server

- `hub.subscribe` composes the snapshot, sends it and adds the subscriber with no `await` in between, so no event lands between the snapshot and the first notification.
- That is why it bypasses the dispatcher, which sends after awaiting; it therefore maps its own errors with `toJsonRpcError`, since no request may crash the process or close the connection.
- Every use case that emits has a test in which the write fails and no event is emitted.
