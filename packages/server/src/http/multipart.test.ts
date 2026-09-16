/**
 * Reading one file out of a multipart body.
 *
 * Hand-rolled, so tested directly. Two things matter most: a part that is a
 * plain form field is not a file and must be skipped rather than stored, and
 * the bytes come back exactly as they went in — a PDF decoded as UTF-8 to find
 * a boundary in it would arrive corrupted and nobody would know until they
 * opened it.
 */
import { describe, expect, it } from "vitest";
import { boundaryOf, firstFilePart } from "./multipart.js";

describe("reading the multipart body", () => {
  function body(parts: string[], boundary = "----x"): Buffer {
    return Buffer.from(`${parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("")}--${boundary}--`);
  }

  it("finds the boundary however the header quotes it", () => {
    expect(boundaryOf('multipart/form-data; boundary="----x"')).toBe("----x");
    expect(boundaryOf("multipart/form-data; boundary=----x")).toBe("----x");
    expect(boundaryOf("application/json")).toBeUndefined();
    expect(boundaryOf(undefined)).toBeUndefined();
  });

  it("reads the file part and its name", () => {
    const part = firstFilePart(
      body(['Content-Disposition: form-data; name="file"; filename="a.md"\r\n\r\nhello']),
      "----x",
    );

    expect(part?.filename).toBe("a.md");
    expect(part?.content.toString("utf8")).toBe("hello");
  });

  it("skips a field that is not a file", () => {
    const part = firstFilePart(
      body([
        'Content-Disposition: form-data; name="why"\r\n\r\nbecause',
        'Content-Disposition: form-data; name="file"; filename="a.md"\r\n\r\nhello',
      ]),
      "----x",
    );

    expect(part?.filename).toBe("a.md");
  });

  it("keeps binary content byte for byte", () => {
    // A PDF decoded as UTF-8 to find a boundary would come out corrupted.
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x0d, 0x0a]);
    const head = Buffer.from(
      '------x\r\nContent-Disposition: form-data; name="f"; filename="a.pdf"\r\n\r\n',
    );
    const tail = Buffer.from("\r\n------x--");

    const part = firstFilePart(Buffer.concat([head, bytes, tail]), "----x");
    expect(part?.content.equals(bytes)).toBe(true);
  });

  it("is undefined rather than throwing on a body that makes no sense", () => {
    expect(firstFilePart(Buffer.from("not multipart at all"), "----x")).toBeUndefined();
    expect(firstFilePart(Buffer.from("------x--"), "----x")).toBeUndefined();
    expect(firstFilePart(Buffer.alloc(0), "----x")).toBeUndefined();
  });
});
