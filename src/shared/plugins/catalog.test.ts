import { describe, it, expect } from "vitest";
import { pluginCatalog, catalogById, featuredCatalog } from "./catalog";

describe("plugin catalog", () => {
  it("has unique ids", () => {
    const ids = pluginCatalog.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("scopes developer-tool plugins to code mode", () => {
    expect(catalogById("github")?.scope).toBe("code");
    expect(catalogById("filesystem")?.scope).toBe("code");
    expect(catalogById("git")?.scope).toBe("code");
  });

  it("configures Supabase as a hosted OAuth server (Notion/Linear-style)", () => {
    const supabase = catalogById("supabase");
    expect(supabase?.transport).toBe("http");
    expect(supabase?.auth).toBe("oauth");
    expect(supabase?.url).toContain("mcp.supabase.com");
  });

  it("configures Convex as a local stdio server scoped to code", () => {
    const convex = catalogById("convex");
    expect(convex?.command).toBe("npx");
    expect(convex?.scope).toBe("code");
    expect(convex?.transport).toBeUndefined(); // stdio (default)
  });

  it("keeps Notion/Linear on OAuth", () => {
    expect(catalogById("notion")?.auth).toBe("oauth");
    expect(catalogById("linear")?.auth).toBe("oauth");
  });

  it("returns only featured entries from featuredCatalog", () => {
    expect(featuredCatalog().every((e) => e.featured)).toBe(true);
  });
});
