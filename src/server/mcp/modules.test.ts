import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moduleForTool } from "./modules";

/**
 * Tool parity guard. The operator's agents discover the product through
 * list_accessible_modules; a tool that belongs to no module is invisible there
 * even though it works. Reads tool names from the tool sources rather than
 * importing them, which would pull in the Workers runtime.
 */

const toolsDir = join(__dirname, "tools");

function registeredToolNames(): string[] {
  const serverSource = readFileSync(join(__dirname, "server.ts"), "utf8");
  const registered = new Set(
    [...serverSource.matchAll(/register\((\w+)\)/g)].map((match) => match[1]),
  );

  const names: string[] = [];
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(toolsDir, file), "utf8");
    for (const match of source.matchAll(
      /export const (\w+)\s*=\s*\{\s*name:\s*"([a-z_]+)"/g,
    )) {
      if (registered.has(match[1])) names.push(match[2]);
    }
  }
  return names;
}

describe("MCP module coverage", () => {
  it("finds the registered tools, so the guard is not vacuous", () => {
    expect(registeredToolNames()).toEqual(
      expect.arrayContaining(["run_brand_lookup", "run_prompt_explorer", "get_domain_overview"]),
    );
  });

  it("puts every registered tool in a module", () => {
    const orphans = registeredToolNames().filter((name) => moduleForTool(name) === null);
    expect(orphans).toEqual([]);
  });
});
