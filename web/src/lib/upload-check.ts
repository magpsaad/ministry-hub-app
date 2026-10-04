/** Security audit #6 (owner-approved, 4 Oct 2026): every upload is checked
 * on the server before it's stored -- size, an allowed type, AND that the
 * file really is that type (its first bytes), whatever its name or the
 * browser claimed. The file's extension comes from the checked type, never
 * from the uploaded name. Storage enforces the same types and sizes
 * (migration 0085). */
export type UploadKind = "photo" | "attachment" | "logo";

type Rule = { maxBytes: number; types: Record<string, string>; tooBig: string; wrongType: string };

const IMAGES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const RULES: Record<UploadKind, Rule> = {
  photo: {
    maxBytes: 10 * 1024 * 1024,
    types: IMAGES,
    tooBig: "That photo is over 10 MB.",
    wrongType: "Please use a JPG, PNG or WebP photo.",
  },
  logo: {
    maxBytes: 2 * 1024 * 1024,
    types: IMAGES,
    tooBig: "That image is over 2 MB. A square image about 512 × 512 pixels is plenty.",
    wrongType: "Use a PNG, JPG or WebP image.",
  },
  attachment: {
    maxBytes: 10 * 1024 * 1024,
    types: {
      ...IMAGES,
      "application/pdf": "pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    },
    tooBig: "That file is over 10 MB.",
    wrongType: "Please attach a PDF, an image (JPG, PNG, WebP) or a Word, Excel or PowerPoint file.",
  },
};

/** Does the file start the way this type must? */
function contentMatches(type: string, b: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  switch (type) {
    case "image/jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b[0] === 0x89 && ascii(1, 4) === "PNG";
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "application/pdf":
      return ascii(0, 5) === "%PDF-";
    default:
      // Word / Excel / PowerPoint files are zip packages.
      return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  }
}

export async function checkUpload(
  file: File | null,
  kind: UploadKind,
): Promise<{ error: string } | { ext: string; contentType: string }> {
  const rule = RULES[kind];
  if (!file || file.size === 0) return { error: "No file selected" };
  if (file.size > rule.maxBytes) return { error: rule.tooBig };
  const ext = rule.types[file.type];
  if (!ext) return { error: rule.wrongType };
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!contentMatches(file.type, head)) return { error: rule.wrongType };
  return { ext, contentType: file.type };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
