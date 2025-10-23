import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
// import { env } from "cloudflare:workers";

// KV storage for authorization codes
interface Env {
  AUTH_CODES: KVNamespace;
}

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        // Simple test: Log every user message to confirm the chat system is working
        const lastUserMessage = cleanedMessages.find(msg => msg.role === "user");
        if (lastUserMessage?.parts?.[0]?.type === "text") {
          const userText = lastUserMessage.parts[0].text;
        }

        const result = streamText({
          system: `You are a helpful assistant that can do various tasks including:

- Weather information for any city
- Local time in different locations  
- Scheduling tasks (one-time, delayed, or recurring)
- Searching for Spotify artist information
- Providing Spotify login link for user authentication
- Getting user's top Spotify artists using authorization code
- Checking if user is logged in to Spotify

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
If the user asks about music artists or wants to search Spotify, use the searchSpotifyArtist tool.
If the user asks "what are my top artists", "show my top artists", "my top Spotify artists", or similar questions about their personal Spotify data, use the loginToSpotify tool first to provide the login link.
If the user asks about Spotify login, authentication, or wants to access their Spotify data, use the loginToSpotify tool first.
If the user asks "am I logged in?", "am I login?", "check my login status", or similar questions about their Spotify login status, use the checkSpotifyLogin tool.
If the user provides an authorization code from Spotify callback and wants to see their top artists, use the getUserTopArtists tool with the authorization code.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    if (url.pathname === "/callback") {
      const authCode = url.searchParams.get("code");
      if (authCode) {
        // Store the authorization code in KV storage for persistence across Worker instances
        await env.AUTH_CODES.put("latestAuthCode", authCode, { expirationTtl: 600 }); // 10 minutes
      }
      
      return new Response("Spotify authentication successful! Authorization code received: " + authCode);
    }

    if (url.pathname === "/get-auth-code") {
      const storedCode = await env.AUTH_CODES.get("latestAuthCode");
      if (storedCode) {
        return new Response(JSON.stringify({ authCode: storedCode }));
      } else {
        return new Response(JSON.stringify({ error: "No authorization code found" }), { status: 404 });
      }
    }

    if (url.pathname === "/test") {
      return new Response("Test endpoint is working! Visit /callback?code=test123 to test the callback.");
    }

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
