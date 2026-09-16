/**
 * Reading one file out of a multipart body.
 *
 * Hand-rolled rather than a dependency, because the office takes exactly one
 * upload of at most ten megabytes from a same-origin browser form, and a general
 * multipart parser is a large amount of attack surface to add for that. It reads
 * the first file part and stops; anything else in the body is ignored rather
 * than processed.
 *
 * Bytes, not strings, all the way through. Decoding a PDF as UTF-8 to find a
 * boundary in it would corrupt the file being uploaded.
 */

export interface ParsedPart {
  filename: string;
  content: Buffer;
}

export function boundaryOf(contentType: string | undefined): string | undefined {
  if (contentType === undefined) return undefined;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const value = (match?.[1] ?? match?.[2])?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** The `filename="..."` of a part, or undefined when the part is not a file. */
function filenameOf(headers: string): string | undefined {
  const quoted = /filename\*?=(?:"([^"]*)"|([^;\r\n]*))/i.exec(headers);
  const raw = (quoted?.[1] ?? quoted?.[2])?.trim();
  if (raw === undefined || raw === "") return undefined;
  // UTF-8 filename* form: charset'lang'value. Only the value is of any use.
  const encoded = /^utf-8''(.*)$/i.exec(raw);
  if (encoded?.[1] !== undefined) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function firstFilePart(body: Buffer, boundary: string): ParsedPart | undefined {
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from("\r\n\r\n");

  let cursor = body.indexOf(delimiter);
  if (cursor === -1) return undefined;

  while (cursor !== -1) {
    const headerStart = cursor + delimiter.length;
    // The closing delimiter is `--boundary--`; nothing follows it.
    if (body.subarray(headerStart, headerStart + 2).toString("latin1") === "--") return undefined;

    const headerEnd = body.indexOf(separator, headerStart);
    if (headerEnd === -1) return undefined;

    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const bodyStart = headerEnd + separator.length;
    const next = body.indexOf(delimiter, bodyStart);
    if (next === -1) return undefined;

    const filename = filenameOf(headers);
    if (filename !== undefined) {
      // The CRLF before the next delimiter belongs to the delimiter, not the file.
      return { filename, content: body.subarray(bodyStart, Math.max(bodyStart, next - 2)) };
    }

    cursor = next;
  }

  return undefined;
}
