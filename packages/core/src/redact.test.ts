import { afterEach, describe, expect, it } from "vitest";
import {
  clearRedaction,
  configureRedaction,
  redactSecrets,
  redactSecretsCounted,
} from "./redact.js";

afterEach(clearRedaction);

describe("configured secrets", () => {
  it("replaces a key wherever it appears, including inside tool output", () => {
    configureRedaction(["sk-ant-abcdefghij"]);
    const event = { text: "called with sk-ant-abcdefghij and it worked" };
    expect(redactSecrets(event)).toEqual({ text: "called with •••• and it worked" });
  });

  it("counts each secret it replaced", () => {
    configureRedaction(["sk-ant-abcdefghij", "ghp_1234567890ab"]);
    const { count } = redactSecretsCounted({
      a: "sk-ant-abcdefghij",
      b: "ghp_1234567890ab",
      c: "fine",
    });
    expect(count).toBe(2);
  });

  it("does not redact a short .env value that appears elsewhere", () => {
    // The case that makes a naive implementation useless: PORT=4242 blanking every 4242.
    configureRedaction(["4242"]);
    expect(redactSecrets({ url: "http://localhost:4242/office" })).toEqual({
      url: "http://localhost:4242/office",
    });
  });

  it("does redact an eight-character .env value, which is the documented trade", () => {
    // The cut-off is length, not cleverness: a non-secret .env value of eight
    // characters or more is blanked too. Erring this way keeps keys out of the log.
    configureRedaction(["localhost"]);
    expect(redactSecrets({ url: "http://localhost:4242/office" })).toEqual({
      url: "http://••••:4242/office",
    });
  });

  it("replaces a longer secret whole when a shorter one is inside it", () => {
    configureRedaction(["abcdefghij", "abcdefghijklmnop"]);
    expect(redactSecrets({ t: "abcdefghijklmnop" })).toEqual({ t: "••••" });
  });

  it("does nothing when nothing is configured", () => {
    expect(redactSecrets({ t: "sk-ant-abcdefghij" })).toEqual({ t: "sk-ant-abcdefghij" });
  });
});

describe("secret-looking keys", () => {
  it("blanks a value whose key names a credential", () => {
    for (const key of [
      "token",
      "api_key",
      "apiKey",
      "API-KEY",
      "secret",
      "password",
      "authorization",
    ]) {
      expect(redactSecrets({ [key]: "aaaaaaaaaaaa" }), key).toEqual({ [key]: "••••" });
    }
  });

  it("leaves a short value under a secret key alone", () => {
    expect(redactSecrets({ token: "abc" })).toEqual({ token: "abc" });
  });

  it("leaves an ordinary key alone", () => {
    expect(redactSecrets({ note: "a perfectly ordinary sentence" })).toEqual({
      note: "a perfectly ordinary sentence",
    });
  });

  it("applies to every element of an array under a secret key", () => {
    expect(redactSecrets({ tokens: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] })).toEqual({
      tokens: ["••••", "••••"],
    });
  });
});

describe("shape and purity", () => {
  it("walks nested objects and arrays", () => {
    configureRedaction(["sk-ant-abcdefghij"]);
    const input = { a: [{ b: { c: "sk-ant-abcdefghij" } }] };
    expect(redactSecrets(input)).toEqual({ a: [{ b: { c: "••••" } }] });
  });

  it("does not mutate its argument", () => {
    configureRedaction(["sk-ant-abcdefghij"]);
    const input = { t: "sk-ant-abcdefghij" };
    redactSecrets(input);
    expect(input.t).toBe("sk-ant-abcdefghij");
  });

  it("passes Date, null, undefined, numbers and booleans through", () => {
    const when = new Date("2026-09-16T00:00:00Z");
    const out = redactSecrets({ when, nothing: null, missing: undefined, n: 42, ok: true });
    expect(out.when).toBe(when);
    expect(out.nothing).toBeNull();
    expect(out.missing).toBeUndefined();
    expect(out.n).toBe(42);
    expect(out.ok).toBe(true);
  });

  it("handles a top-level string", () => {
    configureRedaction(["sk-ant-abcdefghij"]);
    expect(redactSecrets("key is sk-ant-abcdefghij")).toBe("key is ••••");
  });

  it("ignores duplicates and too-short entries when configured", () => {
    configureRedaction(["aaaaaaaaaaaa", "aaaaaaaaaaaa", "short"]);
    const { count } = redactSecretsCounted({ a: "aaaaaaaaaaaa", b: "short" });
    expect(count).toBe(1);
  });
});

describe("the .env marker case", () => {
  it("a marker from .env appearing in tool output is absent from the event, counted once", () => {
    const marker = "MARKER-abcdefghijklmnop";
    configureRedaction([marker]);

    const toolResult = {
      tool: "lookup_order",
      output: `order 91 fetched using ${marker}`,
      meta: { header: `Bearer ${marker}` },
    };
    const { value, count } = redactSecretsCounted(toolResult);

    expect(JSON.stringify(value)).not.toContain(marker);
    expect(value.output).toBe("order 91 fetched using ••••");
    expect(count).toBe(2);
  });
});
