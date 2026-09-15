/**
 * Send a text message through Twilio.
 *
 * This one leaves the computer, so every call waits for you and the card shows
 * the number and the whole message. Credentials come from office/.env:
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.
 *
 * TRY IT: Text Marta to say the banners are ready.
 */
import { tool } from "@staffroom/core";
import { z } from "zod";

export default tool({
  name: "send_sms",
  description: "Send a text message to a phone number.",
  input: z.object({
    to: z.string().describe("The number in international format, for example +61400000000."),
    body: z.string().max(1000).describe("The message itself."),
  }),
  scope: "write",
  egress: true,
  preview: ({ to, body }) => ({
    action: "Send a text message",
    destination: to,
    summary: `Sends a text to ${to}.`,
    body,
    fields: [{ name: "to", value: to, editable: true }],
    // A sent message cannot be recalled, and the card says so in red.
    irreversible: true,
  }),
  run: async ({ to, body }) => {
    const sid = process.env["TWILIO_ACCOUNT_SID"];
    const token = process.env["TWILIO_AUTH_TOKEN"];
    const from = process.env["TWILIO_FROM_NUMBER"];
    if (sid === undefined || token === undefined || from === undefined) {
      return {
        error: "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER to office/.env.",
      };
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      },
    );
    if (!response.ok) return { error: `Twilio said no: ${response.status}` };
    return { sent: true, to };
  },
});
