---
paths:
  - "{packages,apps}/*/{test,e2e}/**/*.ts"
---

# Test

A test earns its place by catching a change in behavior that nothing else would catch.

- See every new test fail before trusting it: write it before the fix, or break the code under test, run it, check it fails for the expected reason, and restore.
- If no test can fail for a defect, protect against it with a type instead.
- Never skip, loosen or delete a failing test to get green: fix the code, or stop and say why the test is wrong.
- Do not test what the type system guarantees; input crossing a boundary is untyped until validated, so validators are tested.
- Do not check the same behavior twice, and do not copy a literal from the source into an assertion.
- Assert errors by class, code and data; match the message only when the message is the behavior under test.
- One `describe` per unit exported from its module, named exactly as the export, and no `describe` for the file.
- Each test name states one behavior and its condition, in the present tense: `returns the defaults when the file is missing`.
- Test files mirror the source: `src/a/b.ts` is tested in `test/a/b.test.ts`.
- A package tests its own adapter against the real dependency (SQLite, the simulated Matter network, a WebSocket on loopback); packages that use it get fakes of the port.
- Fakes are hand-written, implement only what the package uses, and throw on anything else.
- A fake or helper moves to `test/helpers/` when a second test file needs it.
- In `packages/matter`, devices run on the SDK's `NetworkSimulator`; the SDK is never mocked.
- Never sleep: await the event or response that proves the state, use `mock.timers` for time, and to show something did not happen, await a later event ordered after it.
- Test files run in parallel: listen on port 0, write under `mkdtemp`, keep no global state.
- `test/` runs in-process, with no multicast or mDNS; `e2e/` runs the hub over a real network and needs IPv6.
