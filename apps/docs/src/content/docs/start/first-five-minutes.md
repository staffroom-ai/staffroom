---
title: Your first five minutes
description: Connect a model, name your staff, give a task, read the result.
---

1. **Connect a model.** Click the model chip in the header, paste a key, restart
   the office. Without one it replays recorded work: real enough to see how it
   behaves, but not doing your job. See [Providers](/docs/models/providers/).
2. **Rename someone.** Click their name in the chat header and type a new one.
   They are your staff.
3. **Give a task.** Pick a department in the bar at the bottom and ask for
   something in a sentence: *Write a two-line tagline for a bakery.*
4. **Read the result.** It arrives as a card. Open it, or reveal the file on disk.
5. **Look in `~/Staffroom/office/brain/`.** Everything they write is markdown in a
   folder you own. Delete this app tomorrow and the work is still yours.

## Seeing an approval

Give one of your staff a tool that can reach the outside world, then ask them to
use it:

```bash
npx staffroom tools add send-sms --for copywriter
```

Now type that tool's `TRY IT` line into the task bar. They stop and ask before
anything leaves your machine. See [Approvals](/docs/office/approvals/).

## When something is wrong

```bash
npx staffroom doctor
```

It checks Node, your office folder, your config, every provider, every model your
staff name, your tools, and the port — and says what to do about anything it
finds. The same checks are in Settings, under Checks.
