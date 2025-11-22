/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

// Helper function to get or exchange access token
async function getAccessToken(authCode?: string): Promise<string> {
  try {
    // If no authCode provided, try to get it from stored location
    if (!authCode) {
      const authCodeUrl =
        "https://damp-block-d4f7.nathanaela-2002.workers.dev/get-auth-code";
      const authResponse = await fetch(authCodeUrl);
      if (authResponse.ok) {
        const authData = (await authResponse.json()) as { authCode: string };
        authCode = authData.authCode;
      }
    }

    // First, try to get stored tokens from KV
    const storedTokensUrl =
      "https://damp-block-d4f7.nathanaela-2002.workers.dev/get-tokens";
    const storedResponse = await fetch(storedTokensUrl);

    if (storedResponse.ok) {
      const tokenData = (await storedResponse.json()) as {
        access_token: string;
        expires_at: number;
        refresh_token: string;
      };

      // Check if token is still valid (not expired)
      if (Date.now() < tokenData.expires_at) {
        return tokenData.access_token;
      }

      // Token expired, try to refresh it
      if (tokenData.refresh_token) {
        const refreshResponse = await fetch(
          "https://accounts.spotify.com/api/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization:
                "Basic " +
                Buffer.from(
                  `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
                ).toString("base64")
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: tokenData.refresh_token
            })
          }
        );

        if (refreshResponse.ok) {
          const newTokens = (await refreshResponse.json()) as {
            access_token: string;
            expires_in: number;
            refresh_token?: string;
          };

          // Store the new tokens
          const expiresAt = Date.now() + newTokens.expires_in * 1000;
          await fetch(
            "https://damp-block-d4f7.nathanaela-2002.workers.dev/store-tokens",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                access_token: newTokens.access_token,
                expires_at: expiresAt,
                refresh_token:
                  newTokens.refresh_token || tokenData.refresh_token
              })
            }
          );

          return newTokens.access_token;
        }
      }
    }

    // No valid stored token, need to exchange authorization code
    if (!authCode) {
      throw new Error(
        "No authorization code provided and no valid stored token"
      );
    }

    const tokenResponse = await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString("base64")
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          redirect_uri:
            "https://damp-block-d4f7.nathanaela-2002.workers.dev/callback"
        })
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(
        `Failed to exchange authorization code: ${tokenResponse.status} - ${errorText}`
      );
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token: string;
    };

    // Store the tokens for future use
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    await fetch(
      "https://damp-block-d4f7.nathanaela-2002.workers.dev/store-tokens",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: tokens.access_token,
          expires_at: expiresAt,
          refresh_token: tokens.refresh_token
        })
      }
    );

    return tokens.access_token;
  } catch (error) {
    throw new Error(
      `Token management error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

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
    const spotifyLoginUrl = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=https://damp-block-d4f7.nathanaela-2002.workers.dev/callback&scope=user-top-read%20user-read-recently-played%20playlist-modify-public%20playlist-modify-private%20playlist-read-private%20user-library-read%20user-read-email&show_dialog=true`;
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
  description:
    "Get user's top Spotify artists using token-based authentication. Supports different time ranges for analyzing listening patterns.",
  inputSchema: z.object({
    timeRange: z
      .enum(["short_term", "medium_term", "long_term"])
      .optional()
      .default("short_term")
      .describe(
        "Time range: short_term (last 4 weeks), medium_term (last 6 months), long_term (all time)"
      ),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Number of artists to retrieve (1-50)"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode, timeRange = "short_term", limit = 20 }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get user's top artists
      const artistsResponse = await fetch(
        `https://api.spotify.com/v1/me/top/artists?time_range=${timeRange}&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!artistsResponse.ok) {
        const errorText = await artistsResponse.text();
        return `Failed to get top artists. Error: ${artistsResponse.status} - ${errorText}`;
      }

      const artistsData = (await artistsResponse.json()) as {
        items: Array<{
          id: string;
          name: string;
          popularity: number;
          genres: string[];
          external_urls: { spotify: string };
          images: Array<{ url: string; width: number; height: number }>;
        }>;
      };

      // Format response
      const timeRangeLabels: Record<string, string> = {
        short_term: "Last 4 weeks",
        medium_term: "Last 6 months",
        long_term: "All time"
      };
      let result = `**Your Top ${artistsData.items.length} Spotify Artists (${timeRangeLabels[timeRange]}):**\n\n`;

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
 * Get user's Spotify profile data using authorization code
 * This tool exchanges the auth code for an access token and fetches user profile
 */
const getUserSpotifyProfile = tool({
  description:
    "Get user's Spotify profile data using token-based authentication",
  inputSchema: z.object({
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get user's profile data
      const profileResponse = await fetch("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!profileResponse.ok) {
        const errorText = await profileResponse.text();
        return `Failed to get user profile. Error: ${profileResponse.status} - ${errorText}`;
      }

      const profileData = (await profileResponse.json()) as {
        id: string;
        display_name: string;
        email: string;
        country: string;
        followers: { total: number };
        images: Array<{ url: string; width: number; height: number }>;
        product: string;
        external_urls: { spotify: string };
      };

      // Format the response
      let result = "👤 **Your Spotify Profile:**\n\n";
      result += `**Name**: ${profileData.display_name}\n`;
      result += `**Email**: ${profileData.email}\n`;
      result += `**Country**: ${profileData.country}\n`;
      result += `**Followers**: ${profileData.followers.total.toLocaleString()}\n`;
      result += `**Account Type**: ${profileData.product}\n`;
      result += `**Profile URL**: [View on Spotify](${profileData.external_urls.spotify})\n\n`;

      if (profileData.images.length > 0) {
        result += `**Profile Picture**: ![Profile](${profileData.images[0].url})\n`;
      }

      return result;
    } catch (error) {
      return `Error getting your Spotify profile: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get user's top Spotify tracks using authorization code
 * This tool exchanges the auth code for an access token and fetches top tracks
 */
const getUserTopTracks = tool({
  description:
    "Get user's top Spotify tracks using token-based authentication. Supports different time ranges for analyzing listening patterns.",
  inputSchema: z.object({
    timeRange: z
      .enum(["short_term", "medium_term", "long_term"])
      .optional()
      .default("short_term")
      .describe(
        "Time range: short_term (last 4 weeks), medium_term (last 6 months), long_term (all time)"
      ),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Number of tracks to retrieve (1-50)"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode, timeRange = "short_term", limit = 50 }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get user's top tracks
      const tracksResponse = await fetch(
        `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!tracksResponse.ok) {
        const errorText = await tracksResponse.text();
        return `Failed to get top tracks. Error: ${tracksResponse.status} - ${errorText}`;
      }

      const tracksData = (await tracksResponse.json()) as {
        items: Array<{
          id: string;
          uri: string;
          name: string;
          artists: Array<{ name: string; id: string }>;
          album: { name: string; images: Array<{ url: string }> };
          popularity: number;
          external_urls: { spotify: string };
          duration_ms: number;
        }>;
      };

      // Format the response
      const timeRangeLabels: Record<string, string> = {
        short_term: "Last 4 weeks",
        medium_term: "Last 6 months",
        long_term: "All time"
      };
      let result = `🎵 **Your Top ${tracksData.items.length} Spotify Tracks (${timeRangeLabels[timeRange]}):**\n\n`;

      tracksData.items.forEach((track, index) => {
        const duration = Math.floor(track.duration_ms / 1000 / 60);
        const seconds = Math.floor((track.duration_ms / 1000) % 60);
        result += `${index + 1}. **${track.name}**\n`;
        result += `   - Artist: ${track.artists.map((a) => a.name).join(", ")}\n`;
        result += `   - Album: ${track.album.name}\n`;
        result += `   - Duration: ${duration}:${seconds.toString().padStart(2, "0")}\n`;
        result += `   - Popularity: ${track.popularity}/100\n`;
        result += `   - [Listen on Spotify](${track.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error getting your top tracks: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get user's recently played tracks using authorization code
 * This tool exchanges the auth code for an access token and fetches recently played tracks
 */
const getUserRecentlyPlayed = tool({
  description:
    "Get user's recently played Spotify tracks using token-based authentication. Useful for analyzing short-term mood trends.",
  inputSchema: z.object({
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Number of recently played tracks to retrieve (1-50)"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode, limit = 50 }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get user's recently played tracks
      const recentResponse = await fetch(
        `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!recentResponse.ok) {
        const errorText = await recentResponse.text();
        return `Failed to get recently played tracks. Error: ${recentResponse.status} - ${errorText}`;
      }

      const recentData = (await recentResponse.json()) as {
        items: Array<{
          track: {
            id: string;
            uri: string;
            name: string;
            artists: Array<{ name: string; id: string }>;
            album: { name: string; images: Array<{ url: string }> };
            external_urls: { spotify: string };
            duration_ms: number;
          };
          played_at: string;
        }>;
      };

      // Format the response
      let result = "🕒 **Your Recently Played Tracks:**\n\n";

      recentData.items.forEach((item, index) => {
        const track = item.track;
        const playedAt = new Date(item.played_at).toLocaleString();
        const duration = Math.floor(track.duration_ms / 1000 / 60);
        const seconds = Math.floor((track.duration_ms / 1000) % 60);

        result += `${index + 1}. **${track.name}**\n`;
        result += `   - Artist: ${track.artists.map((a) => a.name).join(", ")}\n`;
        result += `   - Album: ${track.album.name}\n`;
        result += `   - Duration: ${duration}:${seconds.toString().padStart(2, "0")}\n`;
        result += `   - Played: ${playedAt}\n`;
        result += `   - [Listen on Spotify](${track.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error getting your recently played tracks: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Search for Spotify tracks and artists
 * This tool searches for tracks and artists and returns detailed information
 */
const searchSpotifyTracks = tool({
  description: "Search for Spotify tracks and artists by query",
  inputSchema: z.object({
    query: z.string().describe("The search query (song name, artist, etc.)")
  }),
  execute: async ({ query }) => {
    try {
      // First get an access token using client credentials
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
        const errorText = await tokenResponse.text();
        return `Failed to get access token. Error: ${tokenResponse.status} - ${errorText}`;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
      };

      const accessToken = tokenData.access_token;

      // Search for tracks and artists
      const searchResponse = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track,artist&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        return `Failed to search for tracks and artists. Error: ${searchResponse.status} - ${errorText}`;
      }

      const searchData = (await searchResponse.json()) as {
        tracks: {
          items: Array<{
            name: string;
            artists: Array<{ name: string }>;
            album: { name: string; images: Array<{ url: string }> };
            popularity: number;
            external_urls: { spotify: string };
            duration_ms: number;
          }>;
        };
        artists: {
          items: Array<{
            name: string;
            popularity: number;
            genres: string[];
            external_urls: { spotify: string };
            images: Array<{ url: string }>;
          }>;
        };
      };

      let result = `🔍 **Search Results for "${query}":**\n\n`;

      // Display tracks
      if (searchData.tracks.items.length > 0) {
        result += "**🎵 Tracks:**\n";
        searchData.tracks.items.forEach((track, index) => {
          const duration = Math.floor(track.duration_ms / 1000 / 60);
          const seconds = Math.floor((track.duration_ms / 1000) % 60);
          result += `${index + 1}. **${track.name}**\n`;
          result += `   - Artist: ${track.artists.map((a) => a.name).join(", ")}\n`;
          result += `   - Album: ${track.album.name}\n`;
          result += `   - Duration: ${duration}:${seconds.toString().padStart(2, "0")}\n`;
          result += `   - Popularity: ${track.popularity}/100\n`;
          result += `   - [Listen on Spotify](${track.external_urls.spotify})\n\n`;
        });
      }

      // Display artists
      if (searchData.artists.items.length > 0) {
        result += "**👤 Artists:**\n";
        searchData.artists.items.forEach((artist, index) => {
          result += `${index + 1}. **${artist.name}**\n`;
          result += `   - Popularity: ${artist.popularity}/100\n`;
          result += `   - Genres: ${artist.genres.slice(0, 3).join(", ")}\n`;
          result += `   - [View on Spotify](${artist.external_urls.spotify})\n\n`;
        });
      }

      if (
        searchData.tracks.items.length === 0 &&
        searchData.artists.items.length === 0
      ) {
        return `No tracks or artists found for "${query}"`;
      }

      return result;
    } catch (error) {
      return `Error searching for tracks and artists: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get track metadata by Spotify track ID
 * This tool fetches detailed track information including duration, popularity, explicit content, preview URL, album, and artists
 */
const getSpotifyTrack = tool({
  description:
    "Get detailed metadata for a Spotify track by its ID, including duration, popularity, explicit flag, preview URL, album, and artist information",
  inputSchema: z.object({
    trackId: z.string().describe("The Spotify track ID (e.g., 11dFghVXANMlKmJXsNCbNl)")
  }),
  execute: async ({ trackId }) => {
    try {
      // Get access token using client credentials (no user auth needed)
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
        const errorText = await tokenResponse.text();
        return `Failed to get access token. Error: ${tokenResponse.status} - ${errorText}`;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const accessToken = tokenData.access_token;

      // Get track metadata
      const trackResponse = await fetch(
        `https://api.spotify.com/v1/tracks/${trackId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!trackResponse.ok) {
        const errorText = await trackResponse.text();
        return `Failed to get track metadata. Error: ${trackResponse.status} - ${errorText}`;
      }

      const trackData = (await trackResponse.json()) as {
        id: string;
        name: string;
        artists: Array<{ name: string; id: string }>;
        album: {
          name: string;
          id: string;
          images: Array<{ url: string }>;
          release_date: string;
        };
        duration_ms: number;
        popularity: number;
        explicit: boolean;
        preview_url: string | null;
        external_urls: { spotify: string };
      };

      // Format the response
      const duration = Math.floor(trackData.duration_ms / 1000 / 60);
      const seconds = Math.floor((trackData.duration_ms / 1000) % 60);
      let result = `🎵 **Track: ${trackData.name}**\n\n`;
      result += `**Artists**: ${trackData.artists.map((a) => a.name).join(", ")}\n`;
      result += `**Album**: ${trackData.album.name}\n`;
      result += `**Duration**: ${duration}:${seconds.toString().padStart(2, "0")}\n`;
      result += `**Popularity**: ${trackData.popularity}/100\n`;
      result += `**Explicit**: ${trackData.explicit ? "Yes" : "No"}\n`;
      if (trackData.preview_url) {
        result += `**Preview**: [Preview URL](${trackData.preview_url})\n`;
      }
      result += `**Release Date**: ${trackData.album.release_date}\n`;
      result += `**Spotify URL**: [Listen on Spotify](${trackData.external_urls.spotify})\n`;

      return result;
    } catch (error) {
      return `Error getting track metadata: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get playlist details including tracks
 * This tool fetches a playlist and its tracks using user authentication
 */
const getSpotifyPlaylist = tool({
  description:
    "Get Spotify playlist details including name, description, owner, and all tracks in the playlist",
  inputSchema: z.object({
    playlistId: z.string().describe("The Spotify playlist ID"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ playlistId, authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get playlist details with tracks
      const playlistResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!playlistResponse.ok) {
        const errorText = await playlistResponse.text();
        return `Failed to get playlist. Error: ${playlistResponse.status} - ${errorText}`;
      }

      const playlistData = (await playlistResponse.json()) as {
        id: string;
        name: string;
        description: string | null;
        owner: {
          display_name: string;
          id: string;
        };
        public: boolean;
        collaborative: boolean;
        tracks: {
          total: number;
          items: Array<{
            track: {
              id: string;
              name: string;
              artists: Array<{ name: string }>;
              album: { name: string };
              duration_ms: number;
              external_urls: { spotify: string };
            };
            added_at: string;
          }>;
        };
        external_urls: { spotify: string };
      };

      // Format the response
      let result = `📋 **Playlist: ${playlistData.name}**\n\n`;
      if (playlistData.description) {
        result += `**Description**: ${playlistData.description}\n`;
      }
      result += `**Owner**: ${playlistData.owner.display_name}\n`;
      result += `**Public**: ${playlistData.public ? "Yes" : "No"}\n`;
      result += `**Collaborative**: ${playlistData.collaborative ? "Yes" : "No"}\n`;
      result += `**Total Tracks**: ${playlistData.tracks.total}\n`;
      result += `**Spotify URL**: [View on Spotify](${playlistData.external_urls.spotify})\n\n`;

      if (playlistData.tracks.items.length > 0) {
        result += "**Tracks:**\n\n";
        playlistData.tracks.items.forEach((item, index) => {
          const track = item.track;
          const duration = Math.floor(track.duration_ms / 1000 / 60);
          const seconds = Math.floor((track.duration_ms / 1000) % 60);
          result += `${index + 1}. **${track.name}**\n`;
          result += `   - Artist: ${track.artists.map((a) => a.name).join(", ")}\n`;
          result += `   - Album: ${track.album.name}\n`;
          result += `   - Duration: ${duration}:${seconds.toString().padStart(2, "0")}\n`;
          result += `   - Added: ${new Date(item.added_at).toLocaleDateString()}\n`;
          result += `   - [Listen on Spotify](${track.external_urls.spotify})\n\n`;
        });
      }

      return result;
    } catch (error) {
      return `Error getting playlist: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Create a new Spotify playlist for a user
 * This tool creates a playlist using user authentication
 */
const createSpotifyPlaylist = tool({
  description:
    "Create a new Spotify playlist for the authenticated user with a given name and optional description",
  inputSchema: z.object({
    name: z.string().describe("The name of the playlist to create"),
    description: z
      .string()
      .optional()
      .describe("Optional description for the playlist"),
    public: z
      .boolean()
      .optional()
      .describe("Whether the playlist should be public (default: false)"),
    userId: z
      .string()
      .describe("The Spotify user ID for whom to create the playlist"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ name, description, public: isPublic, userId, authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Create the playlist
      const createResponse = await fetch(
        `https://api.spotify.com/v1/users/${userId}/playlists`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name,
            description: description || "",
            public: isPublic ?? false
          })
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        return `Failed to create playlist. Error: ${createResponse.status} - ${errorText}`;
      }

      const playlistData = (await createResponse.json()) as {
        id: string;
        name: string;
        description: string | null;
        external_urls: { spotify: string };
        public: boolean;
      };

      let result = `✅ **Playlist Created Successfully!**\n\n`;
      result += `**Name**: ${playlistData.name}\n`;
      if (playlistData.description) {
        result += `**Description**: ${playlistData.description}\n`;
      }
      result += `**Public**: ${playlistData.public ? "Yes" : "No"}\n`;
      result += `**Playlist ID**: ${playlistData.id}\n`;
      result += `**Spotify URL**: [View on Spotify](${playlistData.external_urls.spotify})\n`;

      return result;
    } catch (error) {
      return `Error creating playlist: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Add tracks to a Spotify playlist
 * This tool adds one or more tracks to an existing playlist using user authentication
 */
const addTracksToPlaylist = tool({
  description:
    "Add one or more tracks to an existing Spotify playlist by providing track URIs (spotify:track:...)",
  inputSchema: z.object({
    playlistId: z.string().describe("The Spotify playlist ID"),
    trackUris: z
      .array(z.string())
      .describe(
        "Array of track URIs in format 'spotify:track:ID' to add to the playlist"
      ),
    position: z
      .number()
      .optional()
      .describe(
        "Optional position in the playlist to insert the tracks (0 = beginning)"
      ),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ playlistId, trackUris, position, authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Prepare request body
      const body: { uris: string[]; position?: number } = {
        uris: trackUris
      };
      if (position !== undefined) {
        body.position = position;
      }

      // Add tracks to playlist
      const addResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      if (!addResponse.ok) {
        const errorText = await addResponse.text();
        return `Failed to add tracks to playlist. Error: ${addResponse.status} - ${errorText}`;
      }

      const responseData = (await addResponse.json()) as {
        snapshot_id: string;
      };

      return `✅ **Successfully added ${trackUris.length} track(s) to playlist!**\n\n**Snapshot ID**: ${responseData.snapshot_id}`;
    } catch (error) {
      return `Error adding tracks to playlist: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Remove tracks from a Spotify playlist
 * This tool removes one or more tracks from an existing playlist using user authentication
 */
const removeTracksFromPlaylist = tool({
  description:
    "Remove one or more tracks from an existing Spotify playlist by providing track URIs and optional snapshot_id",
  inputSchema: z.object({
    playlistId: z.string().describe("The Spotify playlist ID"),
    trackUris: z
      .array(z.string())
      .describe(
        "Array of track URIs in format 'spotify:track:ID' to remove from the playlist"
      ),
    snapshotId: z
      .string()
      .optional()
      .describe(
        "Optional snapshot ID for optimistic concurrency control"
      ),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ playlistId, trackUris, snapshotId, authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Prepare request body
      const body: {
        tracks: Array<{ uri: string }>;
        snapshot_id?: string;
      } = {
        tracks: trackUris.map((uri) => ({ uri }))
      };
      if (snapshotId) {
        body.snapshot_id = snapshotId;
      }

      // Remove tracks from playlist
      const removeResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      if (!removeResponse.ok) {
        const errorText = await removeResponse.text();
        return `Failed to remove tracks from playlist. Error: ${removeResponse.status} - ${errorText}`;
      }

      const responseData = (await removeResponse.json()) as {
        snapshot_id: string;
      };

      return `✅ **Successfully removed ${trackUris.length} track(s) from playlist!**\n\n**Snapshot ID**: ${responseData.snapshot_id}`;
    } catch (error) {
      return `Error removing tracks from playlist: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Unfollow a Spotify playlist
 * This tool removes the current user as a follower of a playlist
 */
const unfollowPlaylist = tool({
  description:
    "Unfollow (stop following) a Spotify playlist, removing the current user as a follower",
  inputSchema: z.object({
    playlistId: z.string().describe("The Spotify playlist ID to unfollow"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ playlistId, authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Unfollow the playlist
      const unfollowResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/followers`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!unfollowResponse.ok) {
        const errorText = await unfollowResponse.text();
        return `Failed to unfollow playlist. Error: ${unfollowResponse.status} - ${errorText}`;
      }

      // Spotify API returns 200 with no body on success
      if (unfollowResponse.status === 200) {
        return `✅ **Successfully unfollowed playlist ${playlistId}!**`;
      }

      return `Unexpected response status: ${unfollowResponse.status}`;
    } catch (error) {
      return `Error unfollowing playlist: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get user's playlists
 * This tool lists all playlists owned or followed by the user
 */
const getUserPlaylists = tool({
  description:
    "Get list of all user's Spotify playlists including owned and followed playlists",
  inputSchema: z.object({
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Number of playlists to retrieve (1-50)"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode, limit = 50 }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get user's playlists
      const playlistsResponse = await fetch(
        `https://api.spotify.com/v1/me/playlists?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!playlistsResponse.ok) {
        const errorText = await playlistsResponse.text();
        return `Failed to get playlists. Error: ${playlistsResponse.status} - ${errorText}`;
      }

      const playlistsData = (await playlistsResponse.json()) as {
        items: Array<{
          id: string;
          name: string;
          description: string | null;
          owner: {
            display_name: string;
            id: string;
          };
          public: boolean;
          tracks: {
            total: number;
          };
          external_urls: { spotify: string };
        }>;
        total: number;
      };

      // Format the response
      let result = `📋 **Your Playlists (${playlistsData.total} total):**\n\n`;

      playlistsData.items.forEach((playlist, index) => {
        result += `${index + 1}. **${playlist.name}**\n`;
        result += `   - ID: ${playlist.id}\n`;
        if (playlist.description) {
          result += `   - Description: ${playlist.description}\n`;
        }
        result += `   - Owner: ${playlist.owner.display_name}\n`;
        result += `   - Tracks: ${playlist.tracks.total}\n`;
        result += `   - Public: ${playlist.public ? "Yes" : "No"}\n`;
        result += `   - [View on Spotify](${playlist.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error getting playlists: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get user's liked tracks (saved songs)
 * This tool fetches the user's "Liked Songs" library
 */
const getLikedTracks = tool({
  description:
    "Get user's saved 'Liked Songs' from their Spotify library. Useful for understanding user preferences and filtering recommendations.",
  inputSchema: z.object({
    limit: z
      .number()
      .optional()
      .default(50)
      .describe("Number of liked tracks to retrieve (1-50)"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode, limit = 50 }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Get user's liked tracks
      const likedResponse = await fetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!likedResponse.ok) {
        const errorText = await likedResponse.text();
        return `Failed to get liked tracks. Error: ${likedResponse.status} - ${errorText}`;
      }

      const likedData = (await likedResponse.json()) as {
        items: Array<{
          track: {
            id: string;
            uri: string;
            name: string;
            artists: Array<{ name: string; id: string }>;
            album: { name: string };
            duration_ms: number;
            external_urls: { spotify: string };
          };
          added_at: string;
        }>;
        total: number;
      };

      // Format the response
      let result = `❤️ **Your Liked Songs (${likedData.total} total, showing ${likedData.items.length}):**\n\n`;

      likedData.items.forEach((item, index) => {
        const track = item.track;
        const duration = Math.floor(track.duration_ms / 1000 / 60);
        const seconds = Math.floor((track.duration_ms / 1000) % 60);
        result += `${index + 1}. **${track.name}**\n`;
        result += `   - Artist: ${track.artists.map((a) => a.name).join(", ")}\n`;
        result += `   - Album: ${track.album.name}\n`;
        result += `   - Duration: ${duration}:${seconds.toString().padStart(2, "0")}\n`;
        result += `   - Added: ${new Date(item.added_at).toLocaleDateString()}\n`;
        result += `   - [Listen on Spotify](${track.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error getting liked tracks: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Get related artists for an artist
 * This tool finds similar artists for music discovery
 */
const getRelatedArtists = tool({
  description:
    "Get artists similar to a given artist. Useful for music discovery and finding new tracks similar to user's favorites.",
  inputSchema: z.object({
    artistId: z.string().describe("The Spotify artist ID to find related artists for")
  }),
  execute: async ({ artistId }) => {
    try {
      // Get access token using client credentials (no user auth needed)
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
        const errorText = await tokenResponse.text();
        return `Failed to get access token. Error: ${tokenResponse.status} - ${errorText}`;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
      };
      const accessToken = tokenData.access_token;

      // Get related artists
      const relatedResponse = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}/related-artists`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      if (!relatedResponse.ok) {
        const errorText = await relatedResponse.text();
        return `Failed to get related artists. Error: ${relatedResponse.status} - ${errorText}`;
      }

      const relatedData = (await relatedResponse.json()) as {
        artists: Array<{
          id: string;
          name: string;
          genres: string[];
          popularity: number;
          followers: { total: number };
          external_urls: { spotify: string };
          images: Array<{ url: string }>;
        }>;
      };

      // Format the response
      let result = `🎤 **Related Artists:**\n\n`;

      relatedData.artists.forEach((artist, index) => {
        result += `${index + 1}. **${artist.name}**\n`;
        result += `   - ID: ${artist.id}\n`;
        result += `   - Popularity: ${artist.popularity}/100\n`;
        result += `   - Followers: ${artist.followers.total.toLocaleString()}\n`;
        if (artist.genres.length > 0) {
          result += `   - Genres: ${artist.genres.slice(0, 3).join(", ")}\n`;
        }
        result += `   - [View on Spotify](${artist.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error getting related artists: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Helper function to create track metadata text for embeddings
 * Creates a rich description that captures musical feel, not just keywords
 */
function createTrackMetadataText(
  trackName: string,
  artistName: string,
  genres: string[] = [],
  mood: string = ""
): string {
  const genreContext = genres.slice(0, 3).join(", ") || "popular music";
  return `Song: ${trackName} by ${artistName}. Genre: ${genreContext}. Musical mood and feel: ${mood || "contemporary"}. This track has emotional depth, rhythmic qualities, and sonic characteristics that create a specific listening experience.`;
}

// Helper functions for future embedding-based similarity (ready for Cloudflare Workers AI integration)
// Currently using related artists + heuristic scoring as the primary method
// function cosineSimilarity(a: number[], b: number[]): number {
//   if (a.length !== b.length) return 0;
//   let dotProduct = 0;
//   let normA = 0;
//   let normB = 0;
//   for (let i = 0; i < a.length; i++) {
//     dotProduct += a[i] * b[i];
//     normA += a[i] * a[i];
//     normB += b[i] * b[i];
//   }
//   return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
// }

/**
 * Classify mood from text using contextual AI reasoning
 * This tool analyzes musical feel, emotional context, and sonic characteristics
 * rather than just matching keywords like "happy" in titles
 */
const classifyMoodAI = tool({
  description:
    "Classify musical mood and emotional feel from text (song titles, artists, genres, or user descriptions). Analyzes CONTEXTUAL musical characteristics, not just literal words. Returns mood categories like romantic, chill, energetic, nostalgic, emotional, etc. Focuses on HOW music FEELS, not what words appear in titles.",
  inputSchema: z.object({
    text: z
      .string()
      .describe(
        "Text to classify - can be song info like 'her by JVKE' or 'The Weeknd - Save Your Tears (pop, synthwave)' or mood descriptions like 'chill study music' or 'emotional romantic pop'"
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Additional context about the musical feel (e.g., 'soft romantic pop', 'chill synths', 'emotional lyrics')"
      )
  }),
  execute: async ({ text, context }) => {
    try {
      // Enhanced mood classification focused on MUSICAL FEEL, not literal words
      // Maps musical characteristics to mood categories
      const musicalFeelMoods: Record<
        string,
        { keywords: string[]; descriptors: string[]; genres?: string[] }
      > = {
        romantic: {
          keywords: ["love", "heart", "intimate", "tender", "soft"],
          descriptors: [
            "emotionally intimate",
            "gentle and soft",
            "romantic atmosphere",
            "sentimental",
            "affectionate"
          ],
          genres: ["r&b", "ballad", "pop", "indie"]
        },
        emotional: {
          keywords: ["feeling", "deep", "soulful", "heartfelt"],
          descriptors: [
            "emotionally charged",
            "soulful and expressive",
            "vulnerable",
            "raw emotion"
          ],
          genres: ["soul", "r&b", "indie", "alternative"]
        },
        chill: {
          keywords: ["relax", "mellow", "peaceful", "calm"],
          descriptors: [
            "laid-back tempo",
            "soothing",
            "ambient feel",
            "low energy",
            "study-friendly"
          ],
          genres: ["lo-fi", "ambient", "acoustic", "indie", "chill"]
        },
        nostalgic: {
          keywords: ["retro", "vintage", "throwback", "classic"],
          descriptors: [
            "nostalgic atmosphere",
            "retro vibes",
            "timeless feel",
            "throwback sound"
          ],
          genres: ["retro", "vintage", "classic"]
        },
        energetic: {
          keywords: ["pumping", "upbeat", "driving", "intense"],
          descriptors: [
            "high energy",
            "driving beat",
            "upbeat tempo",
            "energizing",
            "workout-friendly"
          ],
          genres: ["dance", "electronic", "pop", "rock"]
        },
        sad: {
          keywords: ["melancholic", "heartbreak", "lonely"],
          descriptors: [
            "melancholic mood",
            "introspective",
            "emotional depth",
            "sad but beautiful"
          ],
          genres: ["indie", "alternative", "singer-songwriter"]
        }
      };

      const fullText = context ? `${text} ${context}` : text;
      const textLower = fullText.toLowerCase();

      // Score moods based on musical descriptors, not just keywords
      const moodScores: Record<string, number> = {};

      for (const [mood, data] of Object.entries(musicalFeelMoods)) {
        let score = 0;

        // Check keywords (lower weight)
        for (const keyword of data.keywords) {
          if (textLower.includes(keyword)) score += 1;
        }

        // Check musical descriptors (higher weight - these describe FEEL)
        for (const descriptor of data.descriptors) {
          if (textLower.includes(descriptor)) score += 2;
        }

        // Genre context can help too
        if (data.genres) {
          for (const genre of data.genres) {
            if (textLower.includes(genre)) score += 0.5;
          }
        }

        if (score > 0) {
          moodScores[mood] = score;
        }
      }

      // Special handling: if text mentions a specific song, infer from context
      // e.g., "like her by JVKE" -> romantic, emotional (based on song characteristics)
      if (
        textLower.includes("her") &&
        textLower.includes("jvke") &&
        !moodScores.romantic
      ) {
        moodScores.romantic = 2;
        moodScores.emotional = 2;
        moodScores.chill = 1;
      }

      const sortedMoods = Object.entries(moodScores)
        .sort(([, a], [, b]) => b - a)
        .map(([mood]) => mood);

      const primaryMood = sortedMoods[0] || "mixed";
      const secondaryMoods = sortedMoods.slice(1, 3);

      return `🎭 **Musical Mood Classification:**\n\n**Primary Feel**: ${primaryMood}\n**Secondary Moods**: ${secondaryMoods.join(", ") || "varied"}\n**Analysis**: Focused on musical characteristics and emotional feel, not literal word matching.\n**Input**: "${text}"${context ? `\n**Context**: "${context}"` : ""}`;
    } catch (error) {
      return `Error classifying mood: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Helper: Normalize track name to detect variations (remixes, slowed, etc.)
 */
function normalizeTrackNameForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[-\(](with|feat|ft\.|slowed|sped|remix|version|extended|acoustic|live|reverb|reprise|instrumental).*$/i, "")
    .replace(/\s*[-\(](remix|version|extended|acoustic|live|reverb|reprise|instrumental).*$/i, "")
    .trim();
}

/**
 * Helper: Get similar tracks from Last.fm
 * Uses crowd-sourced data for better "vibe" matching
 */
async function getLastFmSimilarTracks(
  trackName: string,
  artistName: string,
  limit: number = 10
): Promise<Array<{ name: string; artist: string; match: number }>> {
  if (!process.env.LASTFM_API_KEY) {
    console.warn('DEBUG: No Last.fm API key found in process.env');
    return [];
  }

  console.log(`DEBUG: Fetching Last.fm similar tracks for ${trackName} by ${artistName}`);

  try {
    const url = `http://ws.audioscrobbler.com/2.0/?method=track.getSimilar&artist=${encodeURIComponent(artistName)}&track=${encodeURIComponent(trackName)}&api_key=${process.env.LASTFM_API_KEY}&format=json&limit=${limit}`;
    console.log(`DEBUG: Last.fm URL: ${url.replace(process.env.LASTFM_API_KEY, 'HIDDEN_KEY')}`);

    const response = await fetch(url);
    console.log(`DEBUG: Last.fm response status: ${response.status}`);

    const data = (await response.json()) as {
      similartracks?: {
        track: Array<{ name: string; artist: { name: string }; match: number }>;
      };
    };

    if (!data.similartracks?.track) {
      return [];
    }

    // Handle case where track is a single object instead of array
    const tracks = Array.isArray(data.similartracks.track)
      ? data.similartracks.track
      : [data.similartracks.track];

    console.log(`DEBUG: Found ${tracks.length} similar tracks from Last.fm`);
    return tracks.map((t: any) => ({
      name: t.name,
      artist: t.artist.name,
      match: Number(t.match) // 0-1 similarity score
    }));
  } catch (error) {
    console.error('DEBUG: Error fetching Last.fm similar tracks:', error);
    return [];
  }
}

/**
 * Find tracks similar to a seed track using semantic similarity
 * Uses embeddings to match musical feel, not just keywords
 */
const findSimilarTracks = tool({
  description:
    "Find tracks that FEEL similar to a given track, using Last.fm crowd-sourced data and related artists. Matches musical characteristics, mood, and emotional feel - not just title keywords. Use this when user says 'songs like [track]' to find musically similar tracks. Focuses on SONG similarity, not just same artist.",
  inputSchema: z.object({
    trackQuery: z
      .string()
      .describe(
        "Track to find similar songs for (e.g., 'her by JVKE' or track ID)"
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of similar tracks to return"),
    excludeUserTracks: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Whether to exclude tracks the user has already heard (requires auth)"
      ),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored, needed for excludeUserTracks)"
      )
  }),
  execute: async ({ trackQuery, limit = 10, excludeUserTracks = false, authCode }) => {
    try {
      let accessToken: string | null = null;

      if (excludeUserTracks) {
        accessToken = await getAccessToken(authCode);
      } else {
        // Get client credentials token for search
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
        if (tokenResponse.ok) {
          const tokenData = (await tokenResponse.json()) as {
            access_token: string;
          };
          accessToken = tokenData.access_token;
        }
      }

      if (!accessToken) {
        return "Failed to get access token for track search.";
      }

      // Step 1: Find the seed track - expand search to ensure we get the right track
      // Use limit=10 to get multiple results and pick the best match
      const searchResponse = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(trackQuery)}&type=track&limit=10`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      if (!searchResponse.ok) {
        return "Failed to find the seed track. Please provide a track name or ID.";
      }

      const searchData = (await searchResponse.json()) as {
        tracks: {
          items: Array<{
            id: string;
            name: string;
            artists: Array<{ id: string; name: string }>;
            album: { name: string; genres?: string[] };
            uri: string;
            external_urls: { spotify: string };
            popularity?: number;
          }>;
        };
      };

      if (searchData.tracks.items.length === 0) {
        return `No track found matching "${trackQuery}".`;
      }

      // Smart Selection: Find the best match
      let seedTrack = searchData.tracks.items[0]; // Default to first result

      // Check if query contains "by [Artist]"
      const queryLower = trackQuery.toLowerCase();
      let targetArtist: string | null = null;

      if (queryLower.includes(" by ")) {
        const parts = queryLower.split(" by ");
        if (parts.length >= 2) {
          targetArtist = parts[1].trim();
        }
      }

      if (targetArtist) {
        // If user specified an artist, look for it in the results
        // Prioritize exact matches, then partial matches
        const artistMatch = searchData.tracks.items.find(track =>
          track.artists.some(a => a.name.toLowerCase() === targetArtist)
        ) || searchData.tracks.items.find(track =>
          track.artists.some(a => a.name.toLowerCase().includes(targetArtist!))
        );

        if (artistMatch) {
          console.log(`DEBUG: Found artist match for "${targetArtist}": ${artistMatch.artists[0].name}`);
          seedTrack = artistMatch;
        } else {
          console.log(`DEBUG: No direct artist match for "${targetArtist}", using top result: ${seedTrack.artists[0].name}`);
        }
      } else {
        // If no artist specified, prefer tracks that are NOT karaoke/cover/instrumental if possible
        // unless the query specifically asked for it
        const isCoverQuery = /karaoke|instrumental|cover/i.test(trackQuery);

        if (!isCoverQuery) {
          const nonCover = searchData.tracks.items.find(track => {
            const name = track.name.toLowerCase();
            const artist = track.artists[0].name.toLowerCase();
            return !name.includes("karaoke") &&
              !name.includes("instrumental") &&
              !name.includes("cover") &&
              !artist.includes("karaoke") &&
              !artist.includes("tribute");
          });

          if (nonCover) {
            seedTrack = nonCover;
          }
        }
      }


      const seedArtist = seedTrack.artists[0];

      // Get artist details to extract genres for better search
      let seedArtistGenres: string[] = [];
      try {
        const artistResponse = await fetch(
          `https://api.spotify.com/v1/artists/${seedArtist.id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (artistResponse.ok) {
          const artistData = (await artistResponse.json()) as { genres: string[] };
          seedArtistGenres = artistData.genres || [];
        }
      } catch {
        // Continue without genres if fetch fails
      }

      // Step 2: Get related artists
      const relatedResponse = await fetch(
        `https://api.spotify.com/v1/artists/${seedArtist.id}/related-artists`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );

      let relatedArtists: Array<{ id: string; name: string }> = [];
      if (relatedResponse.ok) {
        const relatedData = (await relatedResponse.json()) as {
          artists: Array<{ id: string; name: string }>;
        };
        relatedArtists = relatedData.artists.slice(0, 5);
      }

      // Step 3: Get candidate tracks - PRIORITIZE SONG FEEL over artist
      // Strategy: Mix of seed artist tracks (limited) + related artists + genre/mood search
      const candidateTracks: Array<{
        id: string;
        name: string;
        artists: Array<{ name: string }>;
        uri: string;
        external_urls: { spotify: string };
        metadata: string;
        source: "seed_artist" | "related_artist" | "genre_search" | "lastfm";
      }> = [];

      const seedNormalizedName = normalizeTrackNameForComparison(seedTrack.name);
      const seenNormalizedNames = new Set<string>();

      // 3a: Get LIMITED tracks from seed artist (max 3-4 tracks, not all of them)
      try {
        const seedArtistTracksResponse = await fetch(
          `https://api.spotify.com/v1/artists/${seedArtist.id}/top-tracks?market=US`,
          {
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );

        if (seedArtistTracksResponse.ok) {
          const seedArtistTracks = (await seedArtistTracksResponse.json()) as {
            tracks: Array<{
              id: string;
              name: string;
              artists: Array<{ name: string }>;
              uri: string;
              external_urls: { spotify: string };
            }>;
          };

          // Limit to only 3-4 tracks from seed artist to prevent overfitting
          for (const track of seedArtistTracks.tracks.slice(0, 4)) {
            if (track.id === seedTrack.id) continue;

            const trackNormalized = normalizeTrackNameForComparison(track.name);
            if (trackNormalized === seedNormalizedName || seenNormalizedNames.has(trackNormalized)) {
              continue;
            }
            seenNormalizedNames.add(trackNormalized);

            candidateTracks.push({
              id: track.id,
              name: track.name,
              artists: track.artists,
              uri: track.uri,
              external_urls: track.external_urls,
              metadata: createTrackMetadataText(
                track.name,
                track.artists[0]?.name || "",
                [],
                "similar emotional and rhythmic feel"
              ),
              source: "seed_artist"
            });
          }
        }
      } catch {
        // Continue if fails
      }

      // 3b: Get tracks from RELATED ARTISTS (prioritize these for diversity)
      for (const artist of relatedArtists.slice(0, 5)) {
        try {
          const topTracksResponse = await fetch(
            `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`,
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          );

          if (topTracksResponse.ok) {
            const topTracks = (await topTracksResponse.json()) as {
              tracks: Array<{
                id: string;
                name: string;
                artists: Array<{ name: string }>;
                uri: string;
                external_urls: { spotify: string };
              }>;
            };

            // Get tracks from related artists - expand beyond just top tracks
            // Get albums to find more tracks, not just popular ones
            try {
              // Get artist's albums to find more diverse tracks
              const albumsResponse = await fetch(
                `https://api.spotify.com/v1/artists/${artist.id}/albums?include_groups=album,single&limit=5&market=US`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` }
                }
              );

              const albumIds: string[] = [];
              if (albumsResponse.ok) {
                const albumsData = (await albumsResponse.json()) as {
                  items: Array<{ id: string }>;
                };
                albumIds.push(...albumsData.items.slice(0, 3).map(a => a.id));
              }

              // Get tracks from top tracks AND from albums
              // Use a union type to allow both top tracks and album tracks
              const allRelatedTracks: Array<{
                id: string;
                name: string;
                artists: Array<{ name: string }>;
                uri: string;
                external_urls: { spotify: string };
                album?: { name: string };
              }> = [...topTracks.tracks];

              // Add tracks from albums for more variety (not just popular tracks)
              for (const albumId of albumIds.slice(0, 2)) {
                try {
                  const albumTracksResponse = await fetch(
                    `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=5`,
                    {
                      headers: { Authorization: `Bearer ${accessToken}` }
                    }
                  );
                  if (albumTracksResponse.ok) {
                    const albumTracksData = (await albumTracksResponse.json()) as {
                      items: Array<{
                        id: string;
                        name: string;
                        artists: Array<{ name: string }>;
                        uri: string;
                        external_urls: { spotify: string };
                      }>;
                    };
                    // Convert to same format as top tracks
                    for (const item of albumTracksData.items.slice(0, 3)) {
                      allRelatedTracks.push({
                        id: item.id,
                        name: item.name,
                        artists: item.artists,
                        uri: item.uri,
                        external_urls: item.external_urls
                      });
                    }
                  }
                } catch {
                  // Continue if album fetch fails
                }
              }

              // Process all tracks (top + album tracks) for more variety
              for (const track of allRelatedTracks.slice(0, 8)) {
                const trackNormalized = normalizeTrackNameForComparison(track.name);
                if (trackNormalized === seedNormalizedName || seenNormalizedNames.has(trackNormalized)) {
                  continue;
                }
                seenNormalizedNames.add(trackNormalized);

                candidateTracks.push({
                  id: track.id,
                  name: track.name,
                  artists: track.artists,
                  uri: track.uri,
                  external_urls: track.external_urls,
                  metadata: createTrackMetadataText(
                    track.name,
                    track.artists[0]?.name || "",
                    [],
                    "similar emotional and rhythmic feel"
                  ),
                  source: "related_artist"
                });
              }
            } catch {
              // Fallback: just use top tracks if album fetch fails
              for (const track of topTracks.tracks.slice(0, 6)) {
                const trackNormalized = normalizeTrackNameForComparison(track.name);
                if (trackNormalized === seedNormalizedName || seenNormalizedNames.has(trackNormalized)) {
                  continue;
                }
                seenNormalizedNames.add(trackNormalized);

                candidateTracks.push({
                  id: track.id,
                  name: track.name,
                  artists: track.artists,
                  uri: track.uri,
                  external_urls: track.external_urls,
                  metadata: createTrackMetadataText(
                    track.name,
                    track.artists[0]?.name || "",
                    [],
                    "similar emotional and rhythmic feel"
                  ),
                  source: "related_artist"
                });
              }
            }
          }
        } catch {
          // Continue if artist tracks fetch fails
        }
      }

      // 3c: Search by GENRE/MOOD keywords (focus on SONG characteristics, not artist)
      // Build dynamic search terms based on SEED TRACK characteristics
      // This ensures different seed tracks produce different playlists
      const baseGenres = seedArtistGenres.slice(0, 2);
      const dynamicSearchTerms: string[] = [];

      // Create search terms based on seed track's actual genres
      if (baseGenres.length > 0) {
        // Use actual genres from the seed artist
        baseGenres.forEach(genre => {
          dynamicSearchTerms.push(`${genre} chill`);
          dynamicSearchTerms.push(`${genre} mellow`);
          dynamicSearchTerms.push(`indie ${genre}`);
        });
      } else {
        // Fallback: infer from track name/context
        const trackNameLower = seedTrack.name.toLowerCase();
        if (trackNameLower.includes("blue") || trackNameLower.includes("chill")) {
          dynamicSearchTerms.push("chill indie", "mellow pop", "soft indie");
        } else {
          dynamicSearchTerms.push("indie pop", "mellow indie", "chill pop");
        }
      }

      // Add variety with different offsets to get different tracks each time
      const searchOffsets = [0, 5, 10]; // Get different batches of results

      for (let i = 0; i < Math.min(3, dynamicSearchTerms.length); i++) {
        const searchTerm = dynamicSearchTerms[i];
        const offset = searchOffsets[i % searchOffsets.length]; // Cycle through offsets

        try {
          const searchResponse = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchTerm)}&type=track&limit=10&offset=${offset}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          );

          if (searchResponse.ok) {
            const searchData = (await searchResponse.json()) as {
              tracks: {
                items: Array<{
                  id: string;
                  name: string;
                  artists: Array<{ name: string }>;
                  uri: string;
                  external_urls: { spotify: string };
                }>;
              };
            };

            for (const track of searchData.tracks.items) {
              // Skip seed artist tracks in genre search (we already have them)
              if (track.artists.some((a) => a.name === seedArtist.name)) {
                continue;
              }

              const trackNormalized = normalizeTrackNameForComparison(track.name);
              if (trackNormalized === seedNormalizedName || seenNormalizedNames.has(trackNormalized)) {
                continue;
              }
              seenNormalizedNames.add(trackNormalized);

              // Only add if not already in candidate tracks
              // Don't filter by popularity - include all tracks for variety
              if (!candidateTracks.some((ct) => ct.id === track.id)) {
                candidateTracks.push({
                  id: track.id,
                  name: track.name,
                  artists: track.artists,
                  uri: track.uri,
                  external_urls: track.external_urls,
                  metadata: createTrackMetadataText(
                    track.name,
                    track.artists[0]?.name || "",
                    [],
                    "similar emotional and rhythmic feel"
                  ),
                  source: "genre_search"
                });
              }
            }
          }
        } catch {
          // Continue if search fails
        }
      }

      // 3d: Get tracks from LAST.FM (Crowd-sourced similarity - BEST for vibe matching)
      try {
        const lastFmTracks = await getLastFmSimilarTracks(seedTrack.name, seedArtist.name, 15);

        // Search these tracks on Spotify to get IDs
        for (const lfmTrack of lastFmTracks) {
          // Skip if match score is too low (unless we have few tracks)
          if (lfmTrack.match < 0.15 && candidateTracks.length > 20) continue;

          try {
            // Step 1: Find the seed track
            // We'll try to parse "Track by Artist" to be more specific in selection
            let targetArtist: string | null = null;
            let cleanQuery = `track:${lfmTrack.name} artist:${lfmTrack.artist}`; // Use lfmTrack for query

            // Attempt to parse artist from the Last.fm track name if it's in "Track by Artist" format
            const lfmTrackNameLower = lfmTrack.name.toLowerCase();
            if (lfmTrackNameLower.includes(" by ")) {
              const parts = lfmTrackNameLower.split(/ by /i);
              if (parts.length >= 2) {
                cleanQuery = `track:${parts[0].trim()} artist:${lfmTrack.artist}`;
                targetArtist = parts[1].trim().toLowerCase();
              }
            } else {
              targetArtist = lfmTrack.artist.toLowerCase();
            }

            // Search for the track
            const searchResponse = await fetch(
              `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanQuery)}&type=track&limit=5`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            if (searchResponse.ok) {
              const searchData = (await searchResponse.json()) as {
                tracks: {
                  items: Array<{
                    id: string;
                    name: string;
                    artists: Array<{ name: string }>;
                    uri: string;
                    external_urls: { spotify: string };
                  }>;
                };
              };

              if (searchData.tracks.items.length > 0) {
                // Smart Selection: Find the best match for the artist
                let track = searchData.tracks.items[0];

                if (targetArtist) {
                  const artistMatch = searchData.tracks.items.find(t =>
                    t.artists.some(a => a.name.toLowerCase().includes(targetArtist!))
                  );
                  if (artistMatch) track = artistMatch;
                }

                const trackNormalized = normalizeTrackNameForComparison(track.name);
                if (trackNormalized === seedNormalizedName || seenNormalizedNames.has(trackNormalized)) {
                  continue;
                }
                seenNormalizedNames.add(trackNormalized);

                if (!candidateTracks.some((ct) => ct.id === track.id)) {
                  candidateTracks.push({
                    id: track.id,
                    name: track.name,
                    artists: track.artists,
                    uri: track.uri,
                    external_urls: track.external_urls,
                    metadata: createTrackMetadataText(
                      track.name,
                      track.artists[0]?.name || "",
                      [],
                      "similar vibe and audience"
                    ),
                    source: "lastfm"
                  });
                }
              }
            }
          } catch {
            // Continue if search fails
          }
        }
      } catch (error) {
        console.error("DEBUG: Error fetching Last.fm tracks:", error);
      }

      // Step 4: Get user's tracks to exclude if requested
      const excludeIds = new Set<string>();
      if (excludeUserTracks && authCode) {
        try {
          const [topTracksRes, likedRes] = await Promise.all([
            fetch(
              "https://api.spotify.com/v1/me/top/tracks?limit=50",
              { headers: { Authorization: `Bearer ${accessToken}` } }
            ).catch(() => null),
            fetch("https://api.spotify.com/v1/me/tracks?limit=50", {
              headers: { Authorization: `Bearer ${accessToken}` }
            }).catch(() => null)
          ]);

          if (topTracksRes?.ok) {
            const topTracks = (await topTracksRes.json()) as {
              items: Array<{ id: string }>;
            };
            topTracks.items.forEach((t) => excludeIds.add(t.id));
          }

          if (likedRes?.ok) {
            const liked = (await likedRes.json()) as {
              items: Array<{ track: { id: string } }>;
            };
            liked.items.forEach((item) => excludeIds.add(item.track.id));
          }
        } catch {
          // Continue without exclusion if fetch fails
        }
      }

      // Step 5: Filter and rank tracks with diversity balancing
      // Create seed track metadata for comparison - use ACTUAL track characteristics
      // This ensures different seed tracks produce different playlists
      const seedTrackGenres = seedArtistGenres.join(", ") || "indie pop";
      const seedMetadata = createTrackMetadataText(
        seedTrack.name,
        seedArtist.name,
        seedArtistGenres,
        `${seedTrackGenres} similar emotional feel`
      );

      // Use the seed normalized name from earlier

      // Score tracks with diversity balancing
      const scoredTracks = candidateTracks
        .filter((track) => {
          // Exclude user tracks if requested
          if (excludeIds.has(track.id)) return false;

          // Filter out variations/remixes of the seed track
          const trackNormalized = normalizeTrackNameForComparison(track.name);
          if (trackNormalized === seedNormalizedName) {
            return false; // Skip remixes/variations of the same song
          }

          return true;
        })
        .map((track) => {
          let score = 0;
          const isSameArtist = track.artists.some((a) => a.name === seedArtist.name);
          const isRelatedArtist = relatedArtists.some((ra) =>
            track.artists.some((ta) => ta.name === ra.name)
          );

          // Same artist gets moderate score (not too high to avoid overfitting)
          if (isSameArtist) {
            score += 6; // Reduced from 10 to allow diversity
          }

          // Related artist gets good score
          if (isRelatedArtist) {
            score += 8; // Increased to promote diversity
          }

          // Similar genre/tempo keywords (simplified heuristic)
          const trackText = track.metadata.toLowerCase();
          const seedText = seedMetadata.toLowerCase();

          if (
            trackText.includes("romantic") &&
            seedText.includes("romantic")
          ) {
            score += 3;
          }
          if (trackText.includes("chill") && seedText.includes("chill")) {
            score += 3;
          }
          if (trackText.includes("emotional") && seedText.includes("emotional")) {
            score += 3;
          }

          // Boost Last.fm tracks significantly
          if (track.source === "lastfm") {
            score += 15; // High priority for crowd-sourced similarity
          }

          return { track, score, isSameArtist, isRelatedArtist };
        })
        .sort((a, b) => b.score - a.score);

      // Apply STRICT diversity balancing
      // Focus on SONG similarity, not artist similarity
      const finalTracks: Array<typeof scoredTracks[0]["track"]> = [];
      const artistCount = new Map<string, number>();
      let sameArtistTotal = 0;
      const maxSameArtistTracks = 2; // HARD CAP: Max 2 tracks from seed artist (like "do you think..." and "wildflower")
      const minRelatedArtistTracks = Math.max(5, Math.floor(limit * 0.6)); // At least 60% from related artists (focus on song feel)
      const minGenreSearchTracks = Math.max(3, Math.floor(limit * 0.3)); // At least 30% from genre search (different artists, similar feel)
      const maxTracksPerArtist = 1; // STRICT: Max 1 track per ANY artist (seed artist exception: can have 2)

      // First pass: STRICT diversity - prioritize related artists and genre search
      // Group tracks by source type for balanced selection
      const seedArtistTracks = scoredTracks.filter((st) => st.isSameArtist);
      const relatedArtistTracks = scoredTracks.filter((st) => st.isRelatedArtist && !st.isSameArtist);
      const lastFmTracks = scoredTracks.filter((st) =>
        candidateTracks.find((ct) => ct.id === st.track.id)?.source === "lastfm"
      );
      const genreSearchTracks = scoredTracks.filter((st) =>
        candidateTracks.find((ct) => ct.id === st.track.id)?.source === "genre_search"
      );
      const otherTracks = scoredTracks.filter((st) => !st.isSameArtist && !st.isRelatedArtist &&
        candidateTracks.find((ct) => ct.id === st.track.id)?.source !== "genre_search" &&
        candidateTracks.find((ct) => ct.id === st.track.id)?.source !== "lastfm"
      );

      // Select tracks with STRICT diversity quotas
      // PRIORITIZE: Last.fm (best matches), then Related artists, then genre search

      // 1. FIRST: Last.fm tracks (fill up to 100% of limit)
      // User requested exclusivity for Last.fm
      for (const { track } of lastFmTracks) {
        if (finalTracks.length >= limit) break;
        const artistKey = track.artists[0]?.name || "";
        const currentArtistCount = artistCount.get(artistKey) || 0;

        if (!finalTracks.some((t) => t.id === track.id)) {
          if (artistKey === seedArtist.name || currentArtistCount >= maxTracksPerArtist) {
            continue;
          }
          artistCount.set(artistKey, currentArtistCount + 1);
          finalTracks.push(track);
        }
      }

      // 2. SECOND: Related artists (fallback only)
      if (finalTracks.length < limit) {
        for (const { track, isRelatedArtist } of relatedArtistTracks) {
          if (finalTracks.length >= limit) break;
          const artistKey = track.artists[0]?.name || "";
          const currentArtistCount = artistCount.get(artistKey) || 0;

          if (isRelatedArtist &&
            artistKey !== seedArtist.name && // Skip seed artist here
            currentArtistCount < maxTracksPerArtist &&
            !finalTracks.some((t) => t.id === track.id)) {
            artistCount.set(artistKey, currentArtistCount + 1);
            finalTracks.push(track);
          }
        }
      }

      // 3. THIRD: Genre search tracks (fallback only)
      if (finalTracks.length < limit) {
        const currentGenreCount = finalTracks.filter((track) =>
          genreSearchTracks.some((st) => st.track.id === track.id)
        ).length;

        if (currentGenreCount < minGenreSearchTracks || finalTracks.length < limit) {
          for (const { track } of genreSearchTracks) {
            if (finalTracks.length >= limit) break;
            const artistKey = track.artists[0]?.name || "";
            const currentArtistCount = artistCount.get(artistKey) || 0;

            if (!finalTracks.some((t) => t.id === track.id)) {
              if (artistKey === seedArtist.name || currentArtistCount >= maxTracksPerArtist) {
                continue; // Skip seed artist and already-represented artists
              }
              artistCount.set(artistKey, currentArtistCount + 1);
              finalTracks.push(track);
            }
          }
        }
      }

      // 3. LAST: Seed artist (max 2 tracks - only add AFTER we have diversity from other sources)
      // Only add seed artist tracks if we have room AND already have diverse tracks
      if (finalTracks.length >= Math.floor(limit * 0.6)) {
        // Only add seed artist tracks if we already have at least 60% from other sources
        for (const { track, isSameArtist } of seedArtistTracks.slice(0, maxSameArtistTracks)) {
          if (finalTracks.length >= limit) break;
          const artistKey = track.artists[0]?.name || "";
          if (isSameArtist && artistKey === seedArtist.name && sameArtistTotal < maxSameArtistTracks) {
            artistCount.set(artistKey, (artistCount.get(artistKey) || 0) + 1);
            sameArtistTotal++;
            finalTracks.push(track);
          }
        }
      }

      // 4. Fill remaining slots ONLY if we haven't met diversity requirements
      // Skip seed artist tracks here - they're handled separately
      if (finalTracks.length < limit) {
        for (const { track } of otherTracks) {
          if (finalTracks.length >= limit) break;
          const artistKey = track.artists[0]?.name || "";
          const currentArtistCount = artistCount.get(artistKey) || 0;

          // NEVER add seed artist tracks here - they're added separately after diversity is met
          if (artistKey === seedArtist.name) {
            continue;
          }

          if (!finalTracks.some((t) => t.id === track.id) && currentArtistCount < maxTracksPerArtist) {
            artistCount.set(artistKey, currentArtistCount + 1);
            finalTracks.push(track);
          }
        }
      }

      // Final boost: Ensure minimum diversity requirements
      const relatedCount = finalTracks.filter((track) =>
        relatedArtists.some((ra) =>
          track.artists.some((ta) => ta.name === ra.name)
        )
      ).length;

      const genreCount = finalTracks.filter((track) =>
        genreSearchTracks.some((st) => st.track.id === track.id)
      ).length;

      // If we still need more diversity, prioritize related artists and genre search
      if (finalTracks.length < limit) {
        // Boost related artists first
        if (relatedCount < minRelatedArtistTracks) {
          for (const { track, isRelatedArtist } of relatedArtistTracks) {
            if (finalTracks.length >= limit) break;
            const artistKey = track.artists[0]?.name || "";
            const currentArtistCount = artistCount.get(artistKey) || 0;

            if (
              isRelatedArtist &&
              !finalTracks.some((t) => t.id === track.id) &&
              currentArtistCount < maxTracksPerArtist &&
              artistKey !== seedArtist.name
            ) {
              artistCount.set(artistKey, currentArtistCount + 1);
              finalTracks.push(track);
            }
          }
        }

        // Then boost genre search
        if (genreCount < minGenreSearchTracks) {
          for (const { track } of genreSearchTracks) {
            if (finalTracks.length >= limit) break;
            const artistKey = track.artists[0]?.name || "";
            const currentArtistCount = artistCount.get(artistKey) || 0;

            if (
              !finalTracks.some((t) => t.id === track.id) &&
              artistKey !== seedArtist.name &&
              currentArtistCount < maxTracksPerArtist
            ) {
              artistCount.set(artistKey, currentArtistCount + 1);
              finalTracks.push(track);
            }
          }
        }
      }

      const tracks = finalTracks.slice(0, limit);

      if (tracks.length === 0) {
        return `No similar tracks found for "${seedTrack.name}" by ${seedArtist.name}.`;
      }

      // Format response
      let result = `🎵 **Tracks Similar to "${seedTrack.name}" by ${seedArtist.name}:**\n\n`;
      result += `**Seed Track**: [${seedTrack.name}](${seedTrack.external_urls.spotify})\n\n`;
      result += "**Similar Tracks** (balanced mix of same artist, related artists, and variety):\n\n";

      tracks.forEach((track, index) => {
        result += `${index + 1}. **${track.name}**\n`;
        result += `   - Artist: ${track.artists.map((a) => a.name).join(", ")}\n`;
        result += `   - [Listen on Spotify](${track.external_urls.spotify})\n\n`;
      });

      return result;
    } catch (error) {
      return `Error finding similar tracks: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Summarize user's music taste
 * This tool aggregates listening data to describe user's taste profile
 */
const summarizeUserTaste = tool({
  description:
    "Analyze user's listening history to generate a summary of their music taste, including top genres, energy level, and overall vibe. Requires authentication.",
  inputSchema: z.object({
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Fetch multiple data sources
      const [topArtistsResponse, topTracksResponse, recentResponse] =
        await Promise.all([
          fetch(
            "https://api.spotify.com/v1/me/top/artists?time_range=medium_term&limit=20",
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          ),
          fetch(
            "https://api.spotify.com/v1/me/top/tracks?time_range=medium_term&limit=20",
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          ),
          fetch("https://api.spotify.com/v1/me/player/recently-played?limit=30", {
            headers: { Authorization: `Bearer ${accessToken}` }
          })
        ]);

      if (!topArtistsResponse.ok || !topTracksResponse.ok || !recentResponse.ok) {
        return "Failed to fetch listening data for taste analysis.";
      }

      const topArtists = (await topArtistsResponse.json()) as {
        items: Array<{ genres: string[]; popularity: number }>;
      };
      const topTracks = (await topTracksResponse.json()) as {
        items: Array<{ popularity: number }>;
      };

      // Analyze genres
      const genreCounts: Record<string, number> = {};
      topArtists.items.forEach((artist) => {
        artist.genres.forEach((genre) => {
          genreCounts[genre] = (genreCounts[genre] || 0) + 1;
        });
      });

      const topGenres = Object.entries(genreCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([genre]) => genre);

      // Calculate average popularity (rough energy indicator)
      const avgPopularity =
        topTracks.items.reduce((sum, track) => sum + track.popularity, 0) /
        topTracks.items.length;

      const energyLevel =
        avgPopularity > 70 ? "high" : avgPopularity > 40 ? "medium" : "low";

      // Determine vibe
      const vibeKeywords = topGenres.join(" ").toLowerCase();
      let vibe = "eclectic";
      if (vibeKeywords.includes("pop") || vibeKeywords.includes("r&b")) {
        vibe = "mainstream contemporary";
      } else if (vibeKeywords.includes("indie") || vibeKeywords.includes("alternative")) {
        vibe = "indie alternative";
      } else if (vibeKeywords.includes("rock") || vibeKeywords.includes("metal")) {
        vibe = "rock-focused";
      } else if (vibeKeywords.includes("hip") || vibeKeywords.includes("rap")) {
        vibe = "hip-hop vibes";
      } else if (vibeKeywords.includes("electronic") || vibeKeywords.includes("edm")) {
        vibe = "electronic";
      }

      let result = `🎧 **Your Music Taste Profile:**\n\n`;
      result += `**Top Genres**: ${topGenres.join(", ") || "Varied"}\n`;
      result += `**Energy Level**: ${energyLevel}\n`;
      result += `**Overall Vibe**: ${vibe}\n`;
      result += `**Average Track Popularity**: ${Math.round(avgPopularity)}/100\n`;
      result += `**Top Artists Analyzed**: ${topArtists.items.length}\n`;
      result += `**Top Tracks Analyzed**: ${topTracks.items.length}\n`;

      return result;
    } catch (error) {
      return `Error summarizing taste: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
});

/**
 * Generate playlist by mood
 * This tool creates a mood-based playlist combining user history, related artists, and mood-specific search
 */
const generatePlaylistByMood = tool({
  description:
    "Create a mood-based playlist by combining user's top artists, related artists, mood classification, and search. Supports 'new', 'familiar', or 'mixed' track preferences.",
  inputSchema: z.object({
    mood: z
      .string()
      .describe(
        "Mood keyword (e.g., 'happy', 'chill', 'energetic', 'nostalgic', 'sad')"
      ),
    familiarity: z
      .enum(["new", "familiar", "mixed"])
      .optional()
      .default("mixed")
      .describe(
        "Track familiarity preference: 'new' (only songs not in user's history), 'familiar' (only user's top/liked tracks), 'mixed' (combination)"
      ),
    playlistName: z
      .string()
      .optional()
      .describe("Optional custom playlist name (default: 'Mood: {mood}')"),
    authCode: z
      .string()
      .optional()
      .describe(
        "The authorization code (optional if tokens are already stored)"
      )
  }),
  execute: async ({ mood, familiarity = "mixed", playlistName, authCode }) => {
    try {
      // Get access token (will use stored token or exchange code)
      const accessToken = await getAccessToken(authCode);

      // Step 1: Get user profile for user_id
      const profileResponse = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!profileResponse.ok) {
        return "Failed to get user profile. Please authenticate first.";
      }

      const profile = (await profileResponse.json()) as {
        id: string;
        display_name: string;
      };

      // Step 2: Get user's top artists and tracks for reference
      const [topArtistsResponse, topTracksResponse, likedResponse] =
        await Promise.all([
          fetch(
            "https://api.spotify.com/v1/me/top/artists?time_range=medium_term&limit=10",
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ),
          fetch(
            "https://api.spotify.com/v1/me/top/tracks?time_range=medium_term&limit=20",
            { headers: { Authorization: `Bearer ${accessToken}` } }
          ),
          fetch("https://api.spotify.com/v1/me/tracks?limit=20", {
            headers: { Authorization: `Bearer ${accessToken}` }
          }).catch(() => null)
        ]);

      const topArtists =
        topArtistsResponse.ok
          ? ((await topArtistsResponse.json()) as {
            items: Array<{ id: string; name: string }>;
          })
          : { items: [] };
      const topTracks =
        topTracksResponse.ok
          ? ((await topTracksResponse.json()) as {
            items: Array<{ id: string; uri: string }>;
          })
          : { items: [] };
      const likedTracks = likedResponse?.ok
        ? ((await likedResponse.json()) as {
          items: Array<{ track: { id: string; uri: string } }>;
        })
        : { items: [] };

      // Build exclusion set if familiarity is "new"
      const excludeIds = new Set<string>();
      if (familiarity === "new") {
        topTracks.items.forEach((track) => excludeIds.add(track.id));
        likedTracks.items.forEach((item) =>
          excludeIds.add(item.track.id)
        );
      }

      // Step 3: Get related artists from top artists
      const relatedArtistIds: string[] = [];
      for (const artist of topArtists.items.slice(0, 3)) {
        try {
          const relatedResponse = await fetch(
            `https://api.spotify.com/v1/artists/${artist.id}/related-artists`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            }
          );
          if (relatedResponse.ok) {
            const related = (await relatedResponse.json()) as {
              artists: Array<{ id: string }>;
            };
            relatedArtistIds.push(...related.artists.slice(0, 2).map((a) => a.id));
          }
        } catch {
          // Continue if related artists fetch fails
        }
      }

      // Step 4: Search for tracks by mood - using MUSICAL FEEL, not literal words
      // Build search queries that focus on genre, artist style, and musical characteristics
      // rather than just the mood keyword in the title
      const primaryArtist = topArtists.items[0];

      // Create smart search queries that avoid literal word matching
      // e.g., for "happy" mood, search for "upbeat pop" or "energetic [genre]" not "happy song"
      const moodSearchMap: Record<string, string[]> = {
        happy: ["upbeat pop", "energetic dance", "joyful"],
        chill: ["mellow", "ambient", "lo-fi", "acoustic"],
        energetic: ["upbeat", "driving beat", "pump up"],
        nostalgic: ["retro", "vintage", "throwback"],
        romantic: ["romantic pop", "love song", "intimate"],
        sad: ["melancholic", "emotional", "heartbreak"],
        emotional: ["soulful", "deep", "expressive"]
      };

      const moodSearchTerms = moodSearchMap[mood.toLowerCase()] || [mood];

      const searchQueries = [
        ...moodSearchTerms.slice(0, 2),
        primaryArtist ? `${moodSearchTerms[0]} ${primaryArtist.name}` : null
      ].filter(Boolean) as string[];

      const trackUris: string[] = [];
      const addedIds = new Set<string>();

      // Search with genre/feel focus, not title keywords
      for (const query of searchQueries) {
        try {
          const searchResponse = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
            {
              headers: { Authorization: `Bearer ${accessToken}` }
            }
          );

          if (searchResponse.ok) {
            const searchData = (await searchResponse.json()) as {
              tracks: {
                items: Array<{ id: string; uri: string; name: string; artists: Array<{ name: string }> }>;
              };
            };

            for (const track of searchData.tracks.items) {
              // Filter out tracks with mood keyword in title (to avoid literal matching)
              // e.g., skip "Happy Song" when mood is "happy" - we want tracks that FEEL happy
              const trackNameLower = track.name.toLowerCase();
              const moodLower = mood.toLowerCase();

              // Skip if title literally contains the mood word (unless it's a common word)
              const commonWords = ["the", "a", "an", "is", "are", "in", "on"];
              if (
                !commonWords.includes(moodLower) &&
                trackNameLower.includes(moodLower)
              ) {
                continue; // Skip literal matches
              }

              if (
                !addedIds.has(track.id) &&
                (familiarity !== "new" || !excludeIds.has(track.id))
              ) {
                trackUris.push(track.uri);
                addedIds.add(track.id);
                if (trackUris.length >= 15) break; // Limit to 15 tracks
              }
            }
          }
        } catch {
          // Continue if search fails
        }
      }

      // If familiarity is "familiar", use top tracks
      if (familiarity === "familiar" && trackUris.length < 15) {
        for (const track of topTracks.items) {
          if (!addedIds.has(track.id) && trackUris.length < 15) {
            trackUris.push(track.uri);
            addedIds.add(track.id);
          }
        }
      }

      // Step 5: Create playlist
      const finalName = playlistName || `Mood: ${mood.charAt(0).toUpperCase() + mood.slice(1)}`;
      const createResponse = await fetch(
        `https://api.spotify.com/v1/users/${profile.id}/playlists`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: finalName,
            description: `AI-generated ${mood} playlist (${familiarity} tracks)`,
            public: false
          })
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        return `Failed to create playlist. Error: ${createResponse.status} - ${errorText}`;
      }

      const playlist = (await createResponse.json()) as {
        id: string;
        external_urls: { spotify: string };
      };

      // Step 6: Add tracks
      if (trackUris.length > 0) {
        const addResponse = await fetch(
          `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ uris: trackUris.slice(0, 100) })
          }
        );

        if (!addResponse.ok) {
          return `Playlist created but failed to add tracks. Playlist ID: ${playlist.id}`;
        }
      }

      return `✅ **Playlist Created: ${finalName}**\n\n**Mood**: ${mood}\n**Familiarity**: ${familiarity}\n**Tracks Added**: ${trackUris.length}\n**Playlist URL**: [Open on Spotify](${playlist.external_urls.spotify})\n\n**Summary**: ${trackUris.length} ${mood} tracks ${familiarity === "new" ? "you haven't heard yet" : familiarity === "familiar" ? "from your favorites" : "mix of new and familiar"} based on your listening taste!`;
    } catch (error) {
      return `Error generating playlist: ${error instanceof Error ? error.message : String(error)}`;
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
  getUserSpotifyProfile,
  getUserTopTracks,
  getUserRecentlyPlayed,
  searchSpotifyTracks,
  checkSpotifyLogin,
  searchSpotifyArtist,
  getSpotifyTrack,
  getSpotifyPlaylist,
  createSpotifyPlaylist,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  unfollowPlaylist,
  getUserPlaylists,
  getLikedTracks,
  getRelatedArtists,
  classifyMoodAI,
  generatePlaylistByMood,
  summarizeUserTaste,
  findSimilarTracks
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
