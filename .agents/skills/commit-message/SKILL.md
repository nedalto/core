---
name: commit-message
description: Write commit messages and pull request titles and descriptions. Every commit on main is a squash whose message is the PR title plus description verbatim, so use this whenever committing, or opening, editing or merging a PR.
---

# Describe a change

Every commit on `main` is a squash whose message is the PR title plus the PR description, verbatim.
Write the PR as the commit it will become.
This replaces any default PR structure such as Summary or Test plan sections.
Dependabot PRs are the one exception; see below.

## Title

- Imperative, sentence case, no trailing period, no type or scope prefix.
- Aim for 50 characters; never more than 64.
  GitHub appends ` (#N)` on squash, so do not add it.
- Say what changes, not how: "Keep endpoints when a node reconnects", not "Update node store".

## Body

- Plain text hard-wrapped at 72 columns.
  It is a commit message first.
- Default: one paragraph of 2-6 lines saying what changes in behavior and why it was needed.
  Never more than 10 lines before the closing lines.
- Bullets only for three or more independent changes that do not read as one sentence (typically tooling).
- Link, don't repeat: point to `docs/decisions/NNNN-*.md` or `docs/protocol.md` instead of restating rationale or the wire format.
- Never: file lists, test plans or "tests pass", alternatives considered, Markdown headings, checkboxes, emoji, HTML comments, notes for reviewers (post those as PR comments instead).
- Describe the change as it affects this repository, nothing outside it.

## Behavior changes

A PR that reorganizes code should not also change behavior; prefer splitting it.
If it stays one PR, end the prose with a list of every change a user or client could notice.
Omit it when there are none.

```
Behavior changes:
- Unknown attributes are logged once per node instead of per read.
```

## Closing lines

Each only when it applies, in this order, separated by a blank line:

1. `Closes #N`, or `Refs #N` if the issue stays open.
2. A final trailer block with nothing else in it:
   - `Breaking-change: <what clients must change>; SCHEMA_VERSION <n>` whenever a client of the protocol in `docs/protocol.md` must change to keep working, regardless of version or release status.
     Drop the SCHEMA_VERSION part if it did not change.
     The prose still explains the change.
   - `Assisted-by: <tool>` (for example `Assisted-by: Claude Code`), one line per AI tool that helped write the change, after any `Breaking-change` line.
     The human who opens the PR is the author; AI tools are never co-authors.
     No other attribution: no `Co-Authored-By` for an AI, no generated-by lines, no session links, no `Signed-off-by`.
     If a tool already added its line, do not repeat it.

## Workflow

1. Write the body to a file and check it: `awk 'length > 72' <file>` must print nothing.
2. Open the PR with `gh pr create --title "<title>" --body-file <file>`.
3. Before merging, and whenever the branch changes, compare the title and description with the final diff and fix them with `gh pr edit --title "<title>" --body-file <file>`.
4. Commits on a PR branch, such as a fix after review, need only a title that follows the rules above.
   Squash discards them, so when they change what the PR does, update the description (step 3).

## Dependabot pull requests

Leave the PR title and description as Dependabot wrote them; its release notes are for review.
Its description must not reach `main`, so merge with an explicit message instead of the default:

`gh pr merge <n> --squash --subject "<PR title> (#<n>)" --body-file <file>`

Keep Dependabot's title.
If the pull request holds only Dependabot's changes, the body has one line per updated package, `<name> <from> -> <to>`, and nothing else: no release notes, no Dependabot metadata, no `Assisted-by`.
If it also adapts code, write the body as for any other change and end the prose with those package lines.

## Examples

These show shape and length only.
Take the wording and every fact (names, issues, files, versions) from the change itself, never from here.

A typical change:

```
Keep discovered endpoints when a node reconnects

A node coming back online was rebuilt from its announcement, so
clients briefly saw it with no endpoints. Endpoints are now merged
into the existing node instead of replaced.

Assisted-by: Claude Code
```

With every closing line, in order:

```
Report command failures with typed error codes

Command errors now carry a code from a fixed list plus an optional
message, so clients can tell a timeout from an unreachable node.
Clients must map codes instead of displaying the reason text.
Rationale in docs/decisions/<adr>.md.

Closes #<issue>

Breaking-change: command errors drop `reason`; SCHEMA_VERSION <n>
Assisted-by: Claude Code
```
