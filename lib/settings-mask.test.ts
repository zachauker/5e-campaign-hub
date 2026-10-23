import { describe, it, expect } from "vitest";
import { maskSettings } from "./settings-mask";

describe("maskSettings", () => {
  it("masks secrets, including a leftover notion_token row", () => {
    const out = maskSettings([
      { key: "anthropic_api_key", value: "sk-secret" },
      { key: "ddb_cobalt_token", value: "cobalt-secret" },
      { key: "notion_token", value: "secret_notion" },
      { key: "notion_auto_sync_interval_minutes", value: "5" },
      { key: "vault_name", value: "Willowbrook" },
    ]);
    expect(out).toEqual({
      anthropic_api_key: "configured",
      ddb_cobalt_token: "configured",
      notion_token: "configured",
      notion_auto_sync_interval_minutes: "5",
      vault_name: "Willowbrook",
    });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("reports an empty masked value as empty", () => {
    expect(maskSettings([{ key: "notion_token", value: "" }])).toEqual({ notion_token: "" });
  });
});
