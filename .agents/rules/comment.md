---
paths:
  - "{packages,apps}/*/{src,test,e2e}/**/*.ts"
---

# Comment

A comment says what the code, names and types cannot.
When in doubt, leave it out.

- `/** */` only on exported declarations, for what a reader needs on hover and the signature does not say.
- `//` inside bodies, for a non-obvious local why.
- Tool directives keep their own syntax.
- A few lines at most; anything longer is an ADR in `docs/decisions/`, linked from the comment.
- Do not state a guarantee a test or a type could check: write the test or the type.
- Protocol rules that no single type expresses go in `docs/protocol.md`, not in JSDoc.
- Do not restate the code, narrate rejected alternatives or answer a reviewer in advance.
- Behavior outside this repository (the Matter SDK, the Matter spec, Node) is cited with the version it was checked against, and a link when one exists: `// @matter/main <version>: <behavior>`.
- A comment that is no longer true is a bug: when you change code, update or delete its comments.
