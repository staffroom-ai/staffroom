/**
 * What the office says about itself when it is running in a container.
 *
 * The image binds `0.0.0.0`, because the container's own interface is the only
 * way a published port can reach it. Saying "you have bound this to the world,
 * put it behind a VPN" there would be false, and a warning that is false in the
 * normal case is a warning people learn to scroll past — including on the day it
 * is true.
 *
 * The published image cannot be made to prove this until the version carrying it
 * is on npm, so the behaviour is pinned here instead.
 */
import { describe, expect, it } from "vitest";
import {
  DOCKER_NO_ACCOUNTS_WARNING,
  inDocker,
  NO_ACCOUNTS_WARNING,
  noAccountsWarning,
} from "./auth.js";

describe("knowing it is in a container", () => {
  it("is told, rather than guessing", () => {
    // The image sets this. Sniffing for /.dockerenv would also catch podman and
    // miss a container that hides it; being told is the only reliable answer.
    expect(inDocker({ STAFFROOM_IN_DOCKER: "1" })).toBe(true);
  });

  it("is false for anything else, including an empty environment", () => {
    expect(inDocker({})).toBe(false);
    expect(inDocker({ STAFFROOM_IN_DOCKER: "0" })).toBe(false);
    expect(inDocker({ STAFFROOM_IN_DOCKER: "true" })).toBe(false);
  });
});

describe("the no-accounts warning", () => {
  it("names the address somebody bound, outside a container", () => {
    const warning = noAccountsWarning("0.0.0.0", 4242, {});
    expect(warning).toContain("0.0.0.0:4242");
    expect(warning).toContain("VPN");
  });

  it("names the published port instead, inside one", () => {
    const warning = noAccountsWarning("0.0.0.0", 4242, { STAFFROOM_IN_DOCKER: "1" });
    expect(warning).toBe(DOCKER_NO_ACCOUNTS_WARNING);
    // The lever they can actually pull, in the words the docs use.
    expect(warning).toContain("-p 127.0.0.1:4242:4242");
    expect(warning).not.toContain("0.0.0.0:4242");
  });

  it("still says there are no accounts, either way", () => {
    // The part that must never be softened: this is the whole reason the
    // warning exists, and it is true in a container too.
    for (const text of [NO_ACCOUNTS_WARNING, DOCKER_NO_ACCOUNTS_WARNING]) {
      expect(text).toContain("no user accounts");
    }
  });
});
