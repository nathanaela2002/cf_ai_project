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

        const result = streamText({
          system: `You are an AI Music Assistant powered by Spotify. You help users discover music, analyze their listening habits, create mood-based playlists, and manage their Spotify library. You chat naturally and understand user intent around music preferences, moods, and discovery.

CRITICAL COMMUNICATION RULES:
- For multi-step workflows (e.g., "create playlist with songs like [track]"), execute ALL steps in sequence WITHOUT stopping or asking for confirmation
- After the FINAL step completes, THEN provide ONE summary message with the result
- DO NOT provide intermediate messages after each tool - only provide the final summary after all tools complete
- When user asks to create a playlist with similar songs, the workflow is: findSimilarTracks -> createSpotifyPlaylist -> addTracksToPlaylist -> final summary (all automatic, no stops)
- If executing tools in sequence, call the next tool immediately after the previous one completes - do not generate text between tool calls
- Only provide a conversational message after the ENTIRE workflow is complete

CORE CAPABILITIES:
- Mood-based playlist generation (create playlists based on mood like "chill", "energetic", "nostalgic")
- Personal listening stats (top artists, tracks, recently played, taste analysis)
- Music discovery (find similar artists, new tracks not in user's library)
- Playlist management (create, view, add/remove tracks, unfollow playlists)
- Taste summarization (analyze user's music taste, genres, energy levels, vibe)
- Mood classification (detect mood from text or song descriptions)

AUTHENTICATION FLOW:
- Most user-specific operations require Spotify authentication
- If user asks about their personal data but isn't logged in, use loginToSpotify first
- Once authenticated, authCode parameter is optional for subsequent calls

MOOD-BASED PLAYLIST WORKFLOW:
When user requests a mood-based playlist (e.g., "make me something chill", "I feel nostalgic", "hype playlist for gym"):
1. Use generatePlaylistByMood with the mood keyword from user's query
   - Set familiarity to "new" if they want discovery
   - Set familiarity to "familiar" if they want their favorites
   - Set familiarity to "mixed" for balance (default)
2. The tool automatically: fetches user's top tracks, uses Last.fm to find similar tracks, creates playlist, and adds tracks

PERSONAL STATS & INSIGHTS:
- getUserTopArtists: Get user's top artists (supports time_range: short_term/medium_term/long_term)
- getUserTopTracks: Get user's top tracks (supports time_range)
- getUserRecentlyPlayed: Recent listening history for mood trend analysis
- getUserPlaylists: List all user's playlists
- getLikedTracks: Get user's saved "Liked Songs"
- summarizeUserTaste: Generate comprehensive taste profile (genres, energy, vibe)

DISCOVERY TOOLS:
- getRelatedArtists: Find artists similar to a given artist ID (for discovery)
- searchSpotifyTracks: Search Spotify catalog by query
- getSpotifyTrack: Get detailed track metadata by ID

PLAYLIST OPERATIONS:
- createSpotifyPlaylist: Create new playlist (needs user_id from profile)
- getSpotifyPlaylist: View playlist details and tracks
- addTracksToPlaylist: Add tracks (requires URIs in format 'spotify:track:ID')
- removeTracksFromPlaylist: Remove tracks (requires URIs)
- unfollowPlaylist: Unfollow a playlist

TOOL USAGE GUIDELINES:
- CRITICAL: Focus on MUSICAL FEEL and EMOTIONAL SIMILARITY, NOT literal word matching. When user says "songs like her by JVKE", match the ROMANTIC/EMOTIONAL/CHILL musical characteristics, not songs with "happy" in the title.
- CRITICAL: When user asks for "songs like [track]", use Last.fm crowd-sourced similarity data for best results. All song suggestions use Last.fm for vibe matching.
- For mood playlists: Use generatePlaylistByMood directly with the mood keyword - it uses Last.fm similarity from user's top tracks
- For "songs like [track]": Use findSimilarTracks - it uses Last.fm crowd-sourced similarity data
- For taste questions ("what's my vibe?", "what genres do I like?"): Use summarizeUserTaste
- For discovery ("find songs like X but new"): Use findSimilarTracks with excludeUserTracks=true
- For personal stats: Use getUserTopArtists, getUserTopTracks, getUserRecentlyPlayed, getLikedTracks
- When user says "I feel [mood]" or "make me a [mood] playlist": Use generatePlaylistByMood directly with the mood keyword
- When user asks "what's my taste?", "my listening vibe", "my music style": Use summarizeUserTaste
- When user wants "songs like [track]" or "create playlist with songs like [track]": 
  1. Use findSimilarTracks to find similar tracks
  2. AUTOMATICALLY create a playlist using createSpotifyPlaylist
  3. AUTOMATICALLY add the found tracks to the playlist using addTracksToPlaylist
  4. Provide a final summary message with the playlist link
  DO NOT wait for user to say "continue" - execute all steps automatically and provide progress updates
- NEVER match songs based on mood words in titles (e.g., don't include "Happy Song" just because mood is "happy")
- Always check authentication first for user-specific operations using checkSpotifyLogin or loginToSpotify

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
If the user asks about music artists or wants to search Spotify artists, use the searchSpotifyArtist tool.
If the user asks about songs, tracks, or wants to search for music, use the searchSpotifyTracks tool.
If the user asks for track details by ID, use the getSpotifyTrack tool (no authentication needed).
If the user asks to see a playlist, view playlist tracks, or get playlist details, use the getSpotifyPlaylist tool (requires authentication).
If the user asks to list all their playlists, use the getUserPlaylists tool.
If the user asks about their liked songs or saved tracks, use the getLikedTracks tool.
If the user asks to find similar artists or discover new music like an artist, use the getRelatedArtists tool (needs artist ID).
If the user wants songs similar to a specific track (e.g., "songs like her by JVKE"), use findSimilarTracks - it uses Last.fm crowd-sourced similarity data for best vibe matching.
If the user wants a mood-based playlist or says they feel a certain way, use generatePlaylistByMood directly with the mood keyword - it uses Last.fm similarity from user's top tracks.
If the user asks about their music taste, listening style, genres, or overall vibe, use the summarizeUserTaste tool.
If the user asks to create a new playlist, use the createSpotifyPlaylist tool (requires authentication and user ID from profile).
If the user asks to add songs to a playlist, use the addTracksToPlaylist tool (requires authentication and track URIs in format 'spotify:track:ID').
If the user asks to remove songs from a playlist, use the removeTracksFromPlaylist tool (requires authentication and track URIs in format 'spotify:track:ID').
If the user asks to unfollow a playlist, stop following a playlist, or remove a playlist from their library, use the unfollowPlaylist tool (requires authentication).
If the user asks "what are my top artists", "show my top artists", "my top Spotify artists", or similar questions about their personal Spotify data, check authentication first, then use getUserTopArtists (supports time_range parameter).
If the user asks "what are my top tracks", "show my top songs", "my top Spotify tracks", or similar questions, check authentication first, then use getUserTopTracks (supports time_range parameter).
If the user asks "what did I recently play", "my recent tracks", "recently played", or similar questions, check authentication first, then use getUserRecentlyPlayed.
If the user asks about Spotify login, authentication, or wants to access their Spotify data, use the loginToSpotify tool first.
If the user asks "am I logged in?", "am I login?", "check my login status", or similar questions, use the checkSpotifyLogin tool.
If the user asks for their profile data, use the getUserSpotifyProfile tool (authCode is optional if already logged in).
For playlist operations (creating playlists, adding tracks, viewing playlists), make sure the user is authenticated first using loginToSpotify.
When adding tracks to a playlist, you need to convert track IDs to URIs in the format 'spotify:track:TRACK_ID'.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(15), // Increased to allow multi-step workflows to complete (was 10)
          maxSteps: 15 // Enable multi-step calls so model generates text after tool execution
        } as any);

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
        await env.AUTH_CODES.put("latestAuthCode", authCode, {
          expirationTtl: 600
        }); // 10 minutes
      }

      // Redirect back to the app with auth success flag
      // This will trigger the auto-send message in the React app
      return Response.redirect("http://localhost:5173/?auth=success", 302);
    }

    if (url.pathname === "/get-auth-code") {
      const storedCode = await env.AUTH_CODES.get("latestAuthCode");
      if (storedCode) {
        return new Response(JSON.stringify({ authCode: storedCode }));
      } else {
        return new Response(
          JSON.stringify({ error: "No authorization code found" }),
          { status: 404 }
        );
      }
    }

    if (url.pathname === "/get-tokens") {
      const storedTokens = await env.AUTH_CODES.get("spotifyTokens");
      if (storedTokens) {
        return new Response(storedTokens);
      } else {
        return new Response(JSON.stringify({ error: "No tokens found" }), {
          status: 404
        });
      }
    }

    if (url.pathname === "/store-tokens") {
      if (request.method === "POST") {
        const tokenData = await request.json();
        await env.AUTH_CODES.put("spotifyTokens", JSON.stringify(tokenData), {
          expirationTtl: 3600
        }); // 1 hour TTL
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405
      });
    }

    if (url.pathname === "/test") {
      return new Response(
        "Test endpoint is working! Visit /callback?code=test123 to test the callback."
      );
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
