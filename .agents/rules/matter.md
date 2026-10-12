---
paths:
  - "packages/matter/{src,test}/**/*.ts"
---

# Matter

- Every module that imports `@matter/*` imports `sdk-config.ts` first: the SDK reads its configuration when its modules are first evaluated.
- What `matter.ts` exports uses contract types and our ids, and nothing it throws is an SDK error: the gateways translate each into a contract error with the SDK's as `cause`.
- Attribute values and command fields are normalized in one place and at any depth, by value rather than by their declared Matter type: an integer in the safe range is a `number`, any other integer a `bigint`, and bytes are lowercase hex.
- A claim about SDK behavior is checked in its code under `node_modules/@matter/` and cited with that version: the published documentation describes the next release, and other projects may use the legacy API.
- Tests run the controller and devices on the SDK's `NetworkSimulator` in an `Environment` of their own, with the SDK's `MockCrypto` and `MockStorageService`; nothing of the SDK is replaced by hand, and only production uses `Environment.default`.
