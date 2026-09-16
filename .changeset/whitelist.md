---
"@staffroom/core": minor
---

"Approve and always allow" now works: approve a call once and the same call is
not asked about again, recorded in `office/approvals.yaml` where you can read it,
edit it, or delete a row to take the permission back.

The matching is deliberately narrow, because this is the easiest place in the
product to give away more than you meant. A `*` never crosses a comma, semicolon,
whitespace or angle bracket — so `*@acme.com` allows one address at acme and
refuses `evil@x.com,a@acme.com`, which is the same string with a comma in it and
is exactly how permission to email a colleague becomes permission to email
anyone. A list is allowed only if every item in it is. Anything that is not a
string, number or boolean never matches at all.

Permissions expire, they are per agent, and they are pinned to the tool as it was:
if an MCP server changes a tool underneath a permission, the row is suspended
rather than quietly reused and the card tells you it changed.

Allowing every input to a tool has to be asked for explicitly. Somebody clicking
a button on one email does not mean "send anything to anyone from now on".
