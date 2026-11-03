import type { ImportedSource } from "./scenario";

export const MAX_IMPORT_BYTES = 256 * 1024;
export const IMPORT_EXTENSIONS = ["json", "yaml", "yml", "txt", "log"] as const;
export function validateFile(name: string, size: number) {
  const format = name.split(".").pop()?.toLowerCase();
  if (!IMPORT_EXTENSIONS.includes(format as (typeof IMPORT_EXTENSIONS)[number]))
    throw new Error("Choose a JSON, YAML, YML, TXT, or LOG file.");
  if (!size) throw new Error("The selected file is empty.");
  if (size > MAX_IMPORT_BYTES)
    throw new Error("Choose a file no larger than 256 KiB.");
  return format!;
}
function validateStructure(value: unknown) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 10000 || item.depth > 40)
      throw new Error(
        "The document is too complex to preview. Use a simpler source file.",
      );
    if (typeof item.value === "object" && item.value !== null) {
      for (const [key, child] of Object.entries(item.value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error("The document contains an unsupported object key.");
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
}
export async function importSourceText(
  name: string,
  text: string,
  size = new TextEncoder().encode(text).length,
): Promise<ImportedSource> {
  const format = validateFile(name, size);
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new Error("The decoded document exceeds 256 KiB.");
  const content = text.replace(/^\uFEFF/, "");
  if (!content.trim()) throw new Error("The document contains no text.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(content))
    throw new Error("The document must contain valid text, not binary data.");
  let parsed: unknown;
  if (format === "json") {
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Invalid JSON. Check the file syntax before importing.");
    }
  } else if (format === "yaml" || format === "yml") {
    const { parseDocument } = await import("yaml");
    const document = parseDocument(content, {
      schema: "core",
      uniqueKeys: true,
      resolveKnownTags: false,
      customTags: [],
      logLevel: "silent",
    });
    if (document.errors.length || document.warnings.length)
      throw new Error(
        "Invalid or unsupported YAML. Use one document without custom tags or duplicate keys.",
      );
    try {
      parsed = document.toJS({ maxAliasCount: 0 });
    } catch {
      throw new Error(
        "YAML aliases are not supported. Import an expanded document.",
      );
    }
  }
  validateStructure(parsed);
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const label =
    typeof record.name === "string"
      ? record.name
      : typeof record.title === "string"
        ? record.title
        : name;
  const description =
    typeof record.description === "string"
      ? record.description.slice(0, 1000)
      : "Locally imported source material. Preview only; no commands, rules, or playbooks have been executed.";
  const techniques = [
    ...new Set(
      (content.match(/\bT\d{4}(?:\.\d{3})?\b/gi) ?? []).map((id) =>
        id.toUpperCase(),
      ),
    ),
  ].slice(0, 40);
  return {
    id: `local:${crypto.randomUUID()}`,
    name: label.slice(0, 160) || name,
    sourceType: "local_file",
    originalFormat: format,
    description,
    mitreTechniqueIds: techniques,
    rawContent: content,
    importedAt: new Date().toISOString(),
    materialType: "source_material",
  };
}
export async function importLocalFile(file: File): Promise<ImportedSource> {
  validateFile(file.name, file.size);
  return importSourceText(file.name, await file.text(), file.size);
}
export function validateSourceUrl(value: string): string | null {
  if (value.length > 2048) return "Use a URL shorter than 2,048 characters.";
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return "Enter an HTTP or HTTPS URL without embedded credentials.";
  } catch {
    return "Enter a complete HTTP or HTTPS URL.";
  }
  return null;
}
export const URL_IMPORT_UNAVAILABLE =
  "URL retrieval is not connected in this frontend. No request was sent. Browser CORS may prevent access; download a supported text file and use Import File instead.";
