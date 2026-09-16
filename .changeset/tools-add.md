---
"staffroom": minor
"@staffroom/templates": patch
"@staffroom/web": patch
---

`npx staffroom tools add <name> --for <agent>` copies one of the example tools
into your office and gives it to somebody. The README told you to run this; it did
not exist, and a tool on disk that nobody holds does nothing except make you
think the product is broken. Without `--for` it copies the file and tells you who
your staff are so the next command can be copied straight out.

Fixed: the approval demo in the README did not work. Asking for the `send_sms`
tool's own TRY IT line produced an ordinary written answer instead of an approval
card, because the department lead's generic routing transcript rewrote the task
into a brief with none of the original words in it. There is now a routing
transcript for that request.

The approval card no longer prints the destination twice.
