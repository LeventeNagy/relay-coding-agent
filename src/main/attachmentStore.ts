import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Attachment, RawAttachment } from "../shared/agent/types";

/**
 * Stores chat attachments under `userData/attachments/`. Images are written to
 * disk and referenced by id (so session JSON stays small); document bytes are
 * extracted to text at ingest and discarded — only the text is kept (inline on
 * the message, since it's needed as model context anyway).
 */

const MAX_DOC_CHARS = 100_000;

const dir = (): string => join(app.getPath("userData"), "attachments");

const createId = (): string =>
  `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const isImage = (mimeType: string): boolean => mimeType.startsWith("image/");

/** Map known extensions to mime types when the renderer doesn't supply one. */
const mimeFromName = (name: string): string => {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  return map[ext] ?? "application/octet-stream";
};

/** Extract readable text from a document buffer (pdf / docx / plain). */
const extractText = async (buffer: Buffer, mimeType: string, name: string): Promise<string> => {
  try {
    if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      const { extractText: extractPdf, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdf(pdf, { mergePages: true });
      return text.slice(0, MAX_DOC_CHARS);
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.toLowerCase().endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer });
      return value.slice(0, MAX_DOC_CHARS);
    }
    // Plain text / markdown / code / csv / json — decode as UTF-8.
    return buffer.toString("utf8").slice(0, MAX_DOC_CHARS);
  } catch (error) {
    console.error(`[relay] attachment extract failed for ${name}:`, error);
    return "";
  }
};

/** Ingest raw files: persist images, extract document text. Returns refs. */
export const ingest = async (files: RawAttachment[]): Promise<Attachment[]> => {
  const out: Attachment[] = [];
  for (const file of files) {
    const mimeType = file.mimeType || mimeFromName(file.name);
    const id = createId();
    const buffer = Buffer.from(file.data, "base64");

    if (isImage(mimeType)) {
      const path = join(dir(), id);
      mkdirSync(dir(), { recursive: true });
      writeFileSync(path, buffer);
      out.push({ id, name: file.name, mimeType, kind: "image" });
    } else {
      const text = await extractText(buffer, mimeType, file.name);
      out.push({ id, name: file.name, mimeType, kind: "document", text });
    }
  }
  return out;
};

/** Read a stored image back as a data URL (for thumbnails on reopen). */
export const read = (id: string): string | null => {
  try {
    const path = join(dir(), id);
    const buffer = readFileSync(path);
    // Mime isn't stored on disk; sniff the common signatures, default to png.
    const mime = sniffImageMime(buffer);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
};

/** Read a stored image as raw base64 (no data-URL prefix) for model input. */
export const readBase64 = (id: string): string | null => {
  try {
    return readFileSync(join(dir(), id)).toString("base64");
  } catch {
    return null;
  }
};

const sniffImageMime = (buffer: Buffer): string => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/png";
};
