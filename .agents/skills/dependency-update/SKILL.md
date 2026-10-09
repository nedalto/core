---
name: dependency-update
description: Update an external dependency or review a dependency update, including Dependabot pull requests. Use whenever a package version changes, to read every changelog in between, adapt what breaks and find code the new version makes unnecessary.
---

# Update a dependency

The effort follows the risk.
A patch release of a development tool needs the changelog read and the verification run.
A runtime dependency, or any release of a 0.x package, where a minor version may break, needs every step.

## Steps

1. Read the changelog of every version between the installed one and the target, not only the latest.
2. For each breaking change, deprecation or behavior change, search the code for what it touches.
3. Adapt what the update breaks in the same pull request, so `main` never fails.
4. Note what the update makes unnecessary or simpler (a workaround it fixes, code a new feature replaces) and propose it as a separate pull request.
5. Run the verification, and the end-to-end suite when a runtime dependency changed.
6. Report what affects this repository, what was adapted and what follow-up is proposed.

## Matter SDK

- Recheck every comment citing the old `@matter/main` version against the new code under `node_modules/@matter/`, then update its version or delete it.
