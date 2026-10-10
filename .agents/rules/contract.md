---
paths:
  - "packages/contract/src/**/*.ts"
---

# Contract

- Only what crosses a package boundary or the wire lives here, together with the factories of its branded ids and the validators of its schemas; what a single package uses for itself stays in that package.
- Add a type, port method, event or error together with the code that uses it, never ahead of it.
- Values that cross the wire carry integers as `number | bigint` and bytes as lowercase hex, never as `Buffer`, `Uint8Array` or SDK types.
- Add an error subclass only if code catches it by class or it gives the client an actionable case; otherwise reuse the class and tell cases apart with `data.reason` in kebab-case.
- Name `data` keys after the entity (`nodeId`, `endpointId`, `roomId`), as events do.
