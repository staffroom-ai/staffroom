---
"@staffroom/core": minor
"@staffroom/server": minor
"@staffroom/web": minor
---

Three things Settings could not do before: see what you have already allowed,
check the office without leaving it, and change the model everybody uses.

**Standing permissions.** Every row from `approvals.yaml`, with who it is for,
what it is pinned to, and when it was last used — the field that tells a
permission still earning its place from one to take back. Revoke removes that
one row from the file, and the next call asks again.

**Checks.** A button that runs the same checks as `npx staffroom doctor`, in a
table. Same function, so the two surfaces cannot drift apart.

**Default model.** A select filled from what each configured provider says it
can run today, written to `agents.yaml` through the document-mode writer so your
comments survive. A provider that could not answer is named with its reason,
rather than quietly leaving its models out of the list.
