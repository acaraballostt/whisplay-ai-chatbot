import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import moment from "moment";
import { get, isEmpty } from "lodash";
import {
  shouldResetChatHistory,
  systemPrompt,
  updateLastMessageTime,
} from "../../config/llm-config";
import { combineFunction } from "../../utils";
import { llmTools, llmFuncMap } from "../../config/llm-tools";
import dotenv from "dotenv";
import { FunctionCall, Message, ToolReturnTag } from "../../type";
import {
  ChatWithLLMStreamFunction,
  SummaryTextWithLLMFunction,
} from "../interface";
import { chatHistoryDir } from "../../utils/dir";
import {
  extractToolResponse,
  stimulateStreamResponse,
} from "../../config/common";

dotenv.config();

// Grok LLM
const grokAccessToken = process.env.GROK_API_KEY || "";
const grokLLMModel = process.env.GROK_LLM_MODEL || "grok-4-latest";
const grokWebSearchEnabled  = process.env.GROK_WEB_SEARCH_ENABLED  === "true";
const grokXSearchEnabled   = process.env.GROK_X_SEARCH_ENABLED   === "true";
const grokCodeExecEnabled  = process.env.GROK_CODE_EXECUTION_ENABLED === "true";
const grokStoreResponses    = process.env.GROK_STORE_RESPONSES !== "false";
const grokTemperature = parseFloat(process.env.GROK_TEMPERATURE || "0.7");

const chatHistoryFileName = `grok_chat_history_${moment().format(
  "YYYY-MM-DD_HH-mm-ss",
)}.json`;

const messages: Message[] = [
  {
    role: "system",
    content: systemPrompt,
  },
];

const nativeTools: object[] = [];
if (grokWebSearchEnabled)  nativeTools.push({ type: "web_search" });
if (grokXSearchEnabled)   nativeTools.push({ type: "x_search" });
if (grokCodeExecEnabled)  nativeTools.push({ type: "code_execution" });

const resetChatHistory = (): void => {
  messages.length = 0;
  messages.push({
    role: "system",
    content: systemPrompt,
  });
};

const chatWithLLMStream: ChatWithLLMStreamFunction = async (
  inputMessages: Message[] = [],
  partialCallback: (partialAnswer: string) => void,
  endCallback: () => void,
  partialThinkingCallback?: (partialThinking: string) => void,
  invokeFunctionCallback?: (functionName: string, result?: string) => void,
): Promise<void> => {
  if (!grokAccessToken) {
    console.error("Grok access token is not set.");
    return;
  }
  console.log(`[Grok] Calling API with ${inputMessages.length} input messages, nativeTools: ${nativeTools.length}`);
  if (shouldResetChatHistory()) {
    resetChatHistory();
  }
  updateLastMessageTime();
  messages.push(...inputMessages);
  let endResolve: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    endResolve = resolve;
  }).finally(() => {
    fs.writeFileSync(
      path.join(chatHistoryDir, chatHistoryFileName),
      JSON.stringify(messages, null, 2),
    );
  });
  let partialAnswer = "";

  try {
    const response = await axios.post(
      "https://api.x.ai/v1/responses",
      {
        model: grokLLMModel,
        input: messages,
        stream: true,
        tools: [...nativeTools],
        store: grokStoreResponses,
        temperature: grokTemperature,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokAccessToken}`,
        },
        responseType: "stream",
        timeout: 30000,
      },
    );

    let toolUsageStats: any = {};

    response.data.on("data", (chunk: Buffer) => {
      const data = chunk.toString();
      const lines = data.split("\n");

      for (const line of lines) {
        if (!line.trim() || line === "data: [DONE]") continue;
        const jsonStr = line.replace(/^data:\s*/, "");
        try {
          const obj = JSON.parse(jsonStr);

          // Responses API streaming: output array with typed items
          const output = obj.output || [];
          for (const item of output) {
            if (item.type === "reasoning") {
              const text = item.summary?.map((s: any) => s.text).join("") || "";
              if (text) partialThinkingCallback?.(text);
            }
            if (item.type === "message") {
              for (const content of item.content || []) {
                if (content.type === "output_text") {
                  const text = content.text || "";
                  if (text) {
                    partialCallback(text);
                    partialAnswer += text;
                  }
                }
              }
            }
          }

          // Log server-side tool usage in streaming (verbose_streaming)
          if (obj.server_side_tool_usage_details) {
            toolUsageStats = obj.server_side_tool_usage_details;
          }
        } catch (e) {
          // ignore parse errors for non-JSON SSE events
        }
      }
    });

    response.data.on("end", async () => {
      console.log("Stream ended");
      console.log("[Grok] Tool usage:", JSON.stringify(toolUsageStats));

      messages.push({
        role: "assistant",
        content: partialAnswer,
      });

      endResolve();
      endCallback();
    });
  } catch (error: any) {
    console.error("Grok API Error:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      code: error.code,
    });
    endResolve();
    endCallback();
  }

  return promise;
};

const summaryTextWithLLM: SummaryTextWithLLMFunction = async (
  text: string,
  promptPrefix: string,
): Promise<string> => {
  if (!grokAccessToken) {
    console.error("Grok access token is not set. Using original text.");
    return text;
  }
  const response = await axios
    .post(
      "https://api.x.ai/v1/responses",
      {
        model: grokLLMModel,
        input: [
          { role: "user", content: `${promptPrefix}\n\n${text}` }
        ],
        store: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${grokAccessToken}`,
        },
      },
    )
    .catch((error) => {
      console.log("Error during Grok summary request:", error.message);
      return null;
    });
  if (!response) {
    return text;
  }
  const output = get(response, "data.output", []) as any[];
  const summary = output
    .find((item: any) => item.type === "message")
    ?.content?.find((c: any) => c.type === "output_text")?.text || "";

  if (summary) {
    console.log("Grok summary:", summary);
    return summary;
  } else {
    console.log("No summary returned from Grok. Using original text.");
    return text;
  }
};

export default { chatWithLLMStream, resetChatHistory, summaryTextWithLLM };