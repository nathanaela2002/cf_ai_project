/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  inputSchema: z.object({ city: z.string() })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Spotify login tool that executes automatically
 * When invoked, this will provide the user with a Spotify login link
 */
const loginToSpotify = tool({
  description:
    "Provide user with Spotify login link to authenticate and access their Spotify data",
  inputSchema: z.object({}),
  execute: async () => {
    const spotifyLoginUrl =
      "https://accounts.spotify.com/authorize?client_id=cd538c6a2189488fadeaf4a79ced9f70&response_type=code&redirect_uri=https://damp-block-d4f7.nathanaela-2002.workers.dev/callback&scope=user-top-read&show_dialog=true";
    return `To access your Spotify data, please login to Spotify first. 

**Note**: This will redirect to https://damp-block-d4f7.nathanaela-2002.workers.dev/callback.

Click this link to authenticate: ${spotifyLoginUrl}`;
  }
});

/**
 * Get user's top Spotify artists using authorization code
 * This tool exchanges the auth code for an access token and fetches top artists
 */
const getUserTopArtists = tool({
  description: "Get user's top Spotify artists using their authorization code",
  inputSchema: z.object({
    authCode: z
      .string()
      .describe("The authorization code received from Spotify callback")
  }),
  execute: async ({ authCode }) => {
    try {
      //Exchange authorization code for access token
      const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authCode,
            redirect_uri:
              "https://damp-block-d4f7.nathanaela-2002.workers.dev/callback",
            client_id: "cd538c6a2189488fadeaf4a79ced9f70",
            client_secret: "d07e8f67179e495482f6120ab75fca2c"
          })
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        return `Failed to exchange authorization code for access token. Error: ${tokenResponse.status} - ${errorText}`;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        refresh_token: string;
        scope: string;
      };

      // Step 2: Get user's top artists
      const artistsResponse = await fetch(
        "https://api.spotify.com/v1/me/top/artists?time_range=short_term&limit=10",
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`
          }
        }
      );

      if (!artistsResponse.ok) {
        const errorText = await artistsResponse.text();
        return `Failed to get top artists. Error: ${artistsResponse.status} - ${errorText}`;
      }

      const artistsData = (await artistsResponse.json()) as {
        items: Array<{
          name: string;
          popularity: number;
          genres: string[];
          external_urls: { spotify: string };
          images: Array<{ url: string; width: number; height: number }>;
        }>;
      };

      // Format response
      let result = "**Your Top 10 Spotify Artists (Last 4 weeks):**\n\n";

      artistsData.items.forEach((artist, index) => {
        result += `${index + 1}. **${artist.name}**\n`;
        result += `   - Popularity: ${artist.popularity}/100\n`;
        result += `   - Genres: ${artist.genres.slice(0, 3).join(", ")}\n`;
        result += `   - [Listen on Spotify](${artist.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error getting your top artists: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Check Spotify login status tool that executes automatically
 * When invoked, this will check the callback URL to see if user has logged in
 */
const checkSpotifyLogin = tool({
  description:
    "Check if the user is currently logged in to Spotify by checking the callback URL",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      console.log(
        "🔍 Checking Spotify login status by retrieving stored authorization code"
      );

      // Check if there's a stored authorization code
      const authCodeUrl =
        "https://damp-block-d4f7.nathanaela-2002.workers.dev/get-auth-code";
      const response = await fetch(authCodeUrl);

      if (!response.ok) {
        return `You are not logged in to Spotify yet. Please use the login tool to authenticate first.

**Current Status**: No authorization code found.

**Next Steps**: 
1. Use the login tool to start the authentication process
2. Complete the OAuth flow to get an authorization code
3. Then I can check your login status again

Would you like me to provide the login link?`;
      }

      const authData = (await response.json()) as { authCode: string };
      const authCode = authData.authCode;

      if (authCode) {
        return `You are logged in to Spotify! I found your authorization code: ${authCode}

I can now get your top artists. Would you like me to fetch them now?`;
      }

      return `You are not logged in to Spotify yet. Please use the login tool to authenticate first.

**Current Status**: No authorization code found.

**Next Steps**: 
1. Use the login tool to start the authentication process
2. Complete the OAuth flow to get an authorization code
3. Then I can check your login status again

Would you like me to provide the login link?`;
    } catch (error) {
      return `Unable to check login status due to an error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Spotify artist search tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const searchSpotifyArtist = tool({
  description:
    "Search for artist information on Spotify using artist name or Spotify ID",
  inputSchema: z.object({
    query: z.string().describe("Artist name to search for or Spotify artist ID")
  })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask,
  loginToSpotify,
  getUserTopArtists,
  checkSpotifyLogin,
  searchSpotifyArtist
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  },
  searchSpotifyArtist: async ({ query }: { query: string }) => {
    try {
      console.log(`Searching for artist: ${query}`);

      // First, get access token
      const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: process.env.SPOTIFY_CLIENT_ID || "",
            client_secret: process.env.SPOTIFY_CLIENT_SECRET || ""
          })
        }
      );

      if (!tokenResponse.ok) {
        throw new Error(
          `Failed to get access token: ${tokenResponse.statusText}`
        );
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const accessToken = tokenData.access_token;

      // Check if query looks like a Spotify ID (22 characters, alphanumeric)
      const isSpotifyId = /^[a-zA-Z0-9]{22}$/.test(query);

      let artistData: {
        name: string;
        id: string;
        popularity: number;
        genres: string[];
        followers: { total: number };
        external_urls: { spotify: string };
        images: Array<{ url: string; width: number; height: number }>;
      };

      if (isSpotifyId) {
        // Direct artist lookup by ID
        const artistResponse = await fetch(
          `https://api.spotify.com/v1/artists/${query}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        if (!artistResponse.ok) {
          throw new Error(
            `Failed to get artist data: ${artistResponse.statusText}`
          );
        }

        artistData = await artistResponse.json();
      } else {
        // Search for artist by name
        const searchResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=1`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        if (!searchResponse.ok) {
          throw new Error(
            `Failed to search for artist: ${searchResponse.statusText}`
          );
        }

        const searchData = (await searchResponse.json()) as {
          artists: {
            items: Array<{
              name: string;
              id: string;
              popularity: number;
              genres: string[];
              followers: { total: number };
              external_urls: { spotify: string };
              images: Array<{ url: string; width: number; height: number }>;
            }>;
          };
        };

        if (!searchData.artists.items.length) {
          return `No artist found with the name "${query}"`;
        }

        artistData = searchData.artists.items[0];
      }

      // Format the response
      const formattedResponse = {
        name: artistData.name,
        id: artistData.id,
        popularity: artistData.popularity,
        genres: artistData.genres,
        followers: artistData.followers.total,
        external_urls: artistData.external_urls,
        images: artistData.images.map(
          (img: { url: string; width: number; height: number }) => ({
            url: img.url,
            width: img.width,
            height: img.height
          })
        )
      };

      return `Found artist: ${formattedResponse.name}
- Popularity: ${formattedResponse.popularity}/100
- Followers: ${formattedResponse.followers.toLocaleString()}
- Genres: ${formattedResponse.genres.join(", ")}
- Spotify URL: ${formattedResponse.external_urls.spotify}
- Images: ${formattedResponse.images.length} available`;
    } catch (error) {
      console.error("Error searching Spotify artist:", error);
      return `Error searching for artist "${query}": ${error}`;
    }
  }
};
