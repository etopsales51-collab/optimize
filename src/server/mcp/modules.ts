/**
 * Every MCP tool grouped by the product module it belongs to, as reported by
 * list_accessible_modules and accepted by request_module_access.
 *
 * modules.test.ts fails when a tool is registered in server.ts but belongs to
 * no module here, so a new tool cannot ship without appearing in this list.
 * A trailing `*` matches a tool-name prefix.
 */
export const MCP_MODULES = [
  { key: "projects", tools: ["whoami", "list_projects", "create_project"] },
  { key: "project_context", tools: ["get_project_context", "update_project_context"] },
  { key: "keyword_research", tools: ["research_keywords", "get_keyword_metrics", "save_keywords", "list_saved_keywords"] },
  { key: "serp", tools: ["get_serp_results", "get_ranked_keywords", "find_serp_competitors"] },
  { key: "domain", tools: ["get_domain_overview", "get_domain_keyword_suggestions"] },
  { key: "backlinks", tools: ["get_backlinks_overview", "get_backlinks_profile"] },
  { key: "brand_lookup", tools: ["run_brand_lookup"] },
  { key: "prompt_explorer", tools: ["run_prompt_explorer"] },
  { key: "research_runs", tools: ["list_research_runs"] },
  { key: "local_seo", tools: ["search_local_businesses", "get_local_serp_results", "get_google_business_questions", "get_business_*", "get_local_rank_grid", "list_business_categories"] },
  { key: "search_console", tools: ["get_search_console_performance", "inspect_urls", "get_search_opportunities"] },
  { key: "google_analytics", tools: ["get_google_analytics_*"] },
  { key: "rank_tracking", tools: ["get_rank_tracker", "create_rank_tracker", "run_rank_tracker", "add_rank_tracking_keywords", "remove_rank_tracking_keywords", "estimate_rank_tracker_cost"] },
  { key: "site_audit", tools: ["run_site_audit", "get_audit_status", "get_audit_issues", "get_audit_pages"] },
  { key: "optimize", tools: ["create_optimize_recommendation", "update_optimize_recommendation", "list_optimize_recommendations", "get_optimize_recommendation", "add_optimize_comment", "list_optimize_comments", "analyze_intent_overlap", "upload_optimize_image"] },
  { key: "whatsapp", tools: ["list_whatsapp_messages", "send_whatsapp_message"] },
  { key: "module_access", tools: ["list_accessible_modules", "request_module_access"] },
] as const;

export type McpModuleKey = (typeof MCP_MODULES)[number]["key"];

export function moduleForTool(toolName: string): McpModuleKey | null {
  for (const module of MCP_MODULES) {
    const covered = module.tools.some((pattern) =>
      pattern.endsWith("*")
        ? toolName.startsWith(pattern.slice(0, -1))
        : toolName === pattern,
    );
    if (covered) return module.key;
  }
  return null;
}
