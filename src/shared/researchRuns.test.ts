import { describe, expect, it } from "vitest";
import { researchRunsFromToolCall } from "./researchRuns";

describe("researchRunsFromToolCall", () => {
  it("records one keyword run per seed, each reopening its own search", () => {
    const runs = researchRunsFromToolCall("research_keywords", {
      projectId: "p1",
      seeds: [{ seed: "canteen management system" }, { seed: "meal counting", locationCode: 2784 }],
      resultLimit: 300,
    });

    expect(runs).toEqual([
      {
        page: "keywords",
        toolName: "research_keywords",
        target: "canteen management system",
        search: { q: "canteen management system", kLimit: 300 },
      },
      {
        page: "keywords",
        toolName: "research_keywords",
        target: "meal counting",
        search: { q: "meal counting", loc: 2784, kLimit: 300 },
      },
    ]);
  });

  it("writes Prompt Explorer params the way its route does, defaults left out", () => {
    const [run] = researchRunsFromToolCall("run_prompt_explorer", {
      prompt: "best visitor management system in Dubai",
      models: ["chat_gpt", "perplexity"],
      webSearch: true,
      webSearchCountryCode: "US",
      highlightBrand: "eTOP",
    });

    expect(run.search).toEqual({
      q: "best visitor management system in Dubai",
      models: ["chat_gpt", "perplexity"],
      hb: "eTOP",
    });
  });

  it("joins brand lookup competitors into the page's c param", () => {
    const [run] = researchRunsFromToolCall("run_brand_lookup", {
      query: "etopme.ae",
      competitors: ["zkteco.com", "hikvision.com"],
    });
    expect(run.search).toEqual({ q: "etopme.ae", c: "zkteco.com,hikvision.com" });
    expect(run.target).toBe("etopme.ae vs zkteco.com, hikvision.com");
  });

  it("ignores tools that are not page research", () => {
    expect(researchRunsFromToolCall("list_projects", {})).toEqual([]);
    expect(researchRunsFromToolCall("get_domain_overview", { domain: "  " })).toEqual([]);
  });
});
