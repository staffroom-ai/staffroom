/**
 * Fetch a page or an API response.
 *
 * The allow-list at the top is the whole safety story: add the hostnames you
 * want reachable and nothing else is. Without it an agent could be talked into
 * fetching anything by text it found in a note.
 *
 * TRY IT: Fetch the opening hours from our website.
 */
import { tool } from "@staffroom/core";
import { z } from "zod";

const ALLOWED_HOSTS = ["example.com", "www.example.com"];
const MAX_CHARS = 8000;

export default tool({
  name: "http_get",
  description: "Fetch a URL and return its text. Only a few approved sites are reachable.",
  input: z.object({ url: z.string().url() }),
  scope: "read",
  egress: true,
  run: async ({ url }) => {
    const host = new URL(url).hostname;
    if (!ALLOWED_HOSTS.includes(host)) {
      return {
        error: `${host} is not in this tool's allow-list. Add it in office/tools/http-get.ts.`,
      };
    }
    const response = await fetch(url, { headers: { accept: "text/plain, text/html;q=0.9" } });
    if (!response.ok) return { error: `${host} answered ${response.status}` };
    const text = await response.text();
    return { url, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS };
  },
});
