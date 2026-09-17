---
title: Custom tools
description: A small program your staff can call, written by you and running on your machine.
---

A custom tool is a small program that runs inside Staffroom on your computer. It
can read any file, call any website, and use any password you put in it. Agents
can only call it through the input schema you declare, and every `write` tool that
leaves this computer waits for your approval before it runs. Only add tool files
you wrote or that came from someone you trust. Do not paste tool files from the
internet without reading them.

## The contract

```ts
export default {
  name: "lookup_order",
  description: "Look up an order by its number.",
  scope: "read",              // "read" | "write"
  egress: true,               // true if it sends input to a website or service
  inputSchema: {
    type: "object",
    properties: { order_id: { type: "string" } },
    required: ["order_id"],
    additionalProperties: false,
  },
  async run(input, ctx) {
    const res = await fetch(`https://api.example.com/orders/${input.order_id}`, {
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`The order service answered ${res.status}.`);
    return await res.json();
  },
};
```

Drop it in `office/tools/` and it registers within two seconds. A file that will
not compile shows a card with the error and the line, and does not stop the
office.

## scope and egress

`scope: "read"` runs without asking. `scope: "write"` stops and asks, every time,
unless you have given standing permission. A file with no `scope` is treated as
`write` and the office says so, because the safe assumption about a program it has
not been told about is that it changes something.

`egress: true` says the input goes off this machine. It is what puts the red
banner on the approval card.

## Ask an AI to write it

Paste this, filling in the two blanks:

> I use Staffroom. Write me one file `office/tools/<name>.ts` using this contract:
> [paste the example above]. It should <what I want>. Use `scope: "read"` unless
> it changes something outside my computer. Set `egress: true` if it sends any of
> its input to a website or service.

Then read the file before you save it. It runs with your permissions.

## The five that ship

```bash
npx staffroom tools add send-sms --for copywriter
```

`lookup-order`, `sheet-append`, `sqlite-query`, `send-sms` and `http-get`. Each is
under sixty lines with a `TRY IT` line you can type straight into the task bar.
