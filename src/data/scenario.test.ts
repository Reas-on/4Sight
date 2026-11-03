import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_CONTEXT_MAX_LENGTH,
  additionalContextError,
  builtinScenarios,
  compositionBlockReason,
  filterSources,
  sourceAdapters,
} from "./scenario";
import {
  importSourceText,
  MAX_IMPORT_BYTES,
  validateSourceUrl,
} from "./scenarioImport";

describe("independent scenario composition", () => {
  it("accepts optional empty context only with the supported demo and blocks nonempty context", () => {
    expect(additionalContextError("")).toBeNull();
    expect(
      additionalContextError("a".repeat(ADDITIONAL_CONTEXT_MAX_LENGTH)),
    ).toBeNull();
    expect(
      additionalContextError("a".repeat(ADDITIONAL_CONTEXT_MAX_LENGTH + 1)),
    ).not.toBeNull();
    expect(
      compositionBlockReason({
        selectedSource: builtinScenarios[0],
        additionalContext: "",
      }),
    ).toBeNull();
    expect(
      compositionBlockReason({
        selectedSource: builtinScenarios[0],
        additionalContext: "Assume the source is protected.",
      }),
    ).toContain("cannot evaluate composed inputs");
    expect(
      compositionBlockReason({ selectedSource: null, additionalContext: "" }),
    ).toContain("Select");
    expect(
      compositionBlockReason({
        selectedSource: sourceAdapters[0].samples[0],
        additionalContext: "",
      }),
    ).toContain("preview-only");
  });
  it("searches names and filters exact techniques without changing sources", () => {
    const sources = [
      ...builtinScenarios,
      ...sourceAdapters.flatMap((adapter) => adapter.samples),
    ];
    expect(
      filterSources(sources, "ssh", "T1110.001").map((source) => source.name),
    ).toEqual(["SSH Brute Force"]);
    expect(filterSources(sources, "ssh", "T1059")).toEqual([]);
    expect(filterSources(sources, "missing", "")).toEqual([]);
    expect(
      sourceAdapters.every(
        (adapter) =>
          !adapter.live && adapter.samples.every((source) => source.sample),
      ),
    ).toBe(true);
  });
});
describe("safe source import", () => {
  it.each(["json", "yaml", "yml", "txt", "log"])(
    "imports %s as untrusted preview-only material",
    async (format) => {
      const content =
        format === "json"
          ? '{"name":"SSH alert","description":"Material only","technique":"T1110.001"}'
          : format === "yaml" || format === "yml"
            ? "title: SSH alert\ntechnique: T1110.001"
            : "SSH alert\nTechnique T1110.001";
      const result = await importSourceText(`input.${format}`, content);
      expect(result.sourceType).toBe("local_file");
      expect(result.mitreTechniqueIds).toEqual(["T1110.001"]);
      expect(result.rawContent).toBe(content);
      expect(
        compositionBlockReason({
          selectedSource: result,
          additionalContext: "",
        }),
      ).toContain("preview-only");
    },
  );
  it("rejects unsupported, oversized, empty, binary and malformed documents", async () => {
    for (const [name, text, size] of [
      ["file.exe", "not executed", undefined],
      ["a.log", "a", MAX_IMPORT_BYTES + 1],
      ["a.txt", " ", undefined],
      ["a.txt", "\0data", undefined],
      ["a.json", "{bad}", undefined],
      ["a.yaml", "a: [broken", undefined],
    ] as const) {
      await expect(importSourceText(name, text, size)).rejects.toThrow();
    }
  });
  it("rejects alias expansion, custom tags, duplicate YAML keys and unsupported object keys", async () => {
    for (const text of [
      "a: &a [one]\nb: *a",
      "a: !custom text",
      "a: one\na: two",
      "__proto__: test",
    ])
      await expect(importSourceText("test.yaml", text)).rejects.toThrow();
    await expect(
      importSourceText("a.json", '{"__proto__":{"polluted":true}}'),
    ).rejects.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("preserves script-like text as literal source content and rejects excessive nesting", async () => {
    const raw = "<script>alert(1)</script>\nrm -rf /";
    expect((await importSourceText("test.log", raw)).rawContent).toBe(raw);
    await expect(
      importSourceText("deep.json", "[".repeat(45) + "0" + "]".repeat(45)),
    ).rejects.toThrow("complex");
  });
  it("validates URLs without fetching or accepting credentials and non-http schemes", () => {
    expect(validateSourceUrl("https://example.org/source.yml")).toBeNull();
    for (const value of [
      "bad",
      "javascript:alert(1)",
      "file:///tmp/a",
      "https://user:pass@example.org/a",
    ])
      expect(validateSourceUrl(value)).not.toBeNull();
  });
});
