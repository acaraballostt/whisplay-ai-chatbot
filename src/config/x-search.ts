import { LLMTool, ToolReturnTag } from "../type";

// X Search configuration
const xSearchEnabled = process.env.X_SEARCH_ENABLED === "true";

export const xSearchTools: LLMTool[] = [];

if (xSearchEnabled) {
  xSearchTools.push({
    type: "function",
    function: {
      name: "x_search",
      description:
        "Search X (formerly Twitter) for current tweets, threads, and content. " +
        "Use this when the user asks about X/Twitter, wants real-time social media data, " +
        "or needs current conversations about a topic. Returns search results with posts, tweets, and user information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for keywords or topics on X",
          },
          allowed_x_handles: {
            type: "array",
            description: "Only consider posts from specific X handles (max 20 handles)",
            items: { type: "string" },
            maxItems: 20,
          },
          excluded_x_handles: {
            type: "array",
            description: "Exclude posts from specific X handles (max 20 handles)",
            items: { type: "string" },
            maxItems: 20,
          },
          from_date: {
            type: "string",
            description: "Start date for search range (ISO8601 format, e.g., YYYY-MM-DD)",
          },
          to_date: {
            type: "string",
            description: "End date for search range (ISO8601 format, e.g., YYYY-MM-DD)",
          },
          enable_image_understanding: {
            type: "boolean",
            description: "Enable analysis of images in X posts",
          },
          enable_video_understanding: {
            type: "boolean",
            description: "Enable analysis of videos in X posts",
          },
        },
        required: ["query"],
      },
    },
    func: async (params: any) => {
      try {
        return `${ToolReturnTag.Success}X Search tool activated. Grok will now search X for: "${params.query}" with specified parameters.`;
      } catch (error: any) {
        console.error("[X Search] Tool invocation error:", error);
        return `${ToolReturnTag.Error}Failed to invoke X Search: ${error.message}`;
      }
    },
  });
} else {
  console.warn("[X Search] X Search is disabled. Set X_SEARCH_ENABLED=true in .env to enable.");
}

export const addXSearchTools = (tools: LLMTool[]) => {
  if (xSearchTools.length > 0) {
    console.log(
      `[X Search] Adding ${xSearchTools.length} tool(s): x_search`
    );
    tools.push(...xSearchTools);
  }
};