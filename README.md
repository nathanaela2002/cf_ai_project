# Beatsmith AI
Beatsmith AI is an AI-powered music discovery assistant built with Cloudflare's Agent platform, powered by [`agents`](https://www.npmjs.com/package/agents). Discover new songs, find similar artists, and explore music through natural conversation with AI.

## Features

- Music discovery and recommendations
- Search Spotify tracks and artists
- Find similar songs using Last.fm data
- Discover related artists
- Get detailed track information
- Dark/Light theme support
- Real-time streaming responses
- State management and chat history
- Modern, responsive UI

## Prerequisites

- Cloudflare account
- OpenAI API key
- Spotify API credentials (Client ID and Client Secret)
- Last.fm API key

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Set up your environment:

Create a `.dev.vars` file:

```env
OPENAI_API_KEY=your_openai_api_key
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
LASTFM_API_KEY=your_lastfm_api_key
```

To get your API keys:
- **OpenAI API Key**: Sign up at [OpenAI](https://platform.openai.com/api-keys)
- **Spotify Credentials**: Create an app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
- **Last.fm API Key**: Get an API key at [Last.fm API](https://www.last.fm/api/account/create)

### Accessing Login Features

**Note**: The Spotify login system has been deprecated in the default implementation. However, if you want to enable user-specific features (such as accessing user's top tracks, playlists, or creating playlists), you will need to:

1. Set up your own Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Configure the redirect URI in your Spotify app settings to match your deployment URL (e.g., `https://your-domain.workers.dev/callback`)
3. Add yourself and any other users to the **User Management** section of your Spotify app
4. Update the callback URL in `tools.ts` to match your deployment
5. Users must be explicitly added to your Spotify app's user list before they can authenticate

Without setting up your own Spotify app with user management, only public Spotify features (search, track info, related artists) will be available.

3. Run locally:

```bash
npm start
```

4. Deploy:

```bash
npm run deploy
```

## Project Structure

```
├── src/
│   ├── app.tsx        # Chat UI implementation
│   ├── server.ts      # Chat agent logic
│   ├── tools.ts       # Tool definitions
│   ├── utils.ts       # Helper functions
│   └── styles.css     # UI styling
```

## Available Tools

Beatsmith AI comes with the following music-related tools:

- **Search Spotify Tracks** - Search for songs and artists on Spotify
- **Find Similar Songs** - Discover tracks similar to a given song using Last.fm data
- **Get Related Artists** - Find artists similar to a given artist
- **Get Track Information** - Retrieve detailed metadata for any Spotify track
- **Search Spotify Artist** - Look up artist information by name or ID

## Customization Guide

### Adding New Tools

Add new tools in `tools.ts` using the tool builder:

```ts
// Example of a tool that requires confirmation
const searchDatabase = tool({
  description: "Search the database for user records",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().optional()
  })
  // No execute function = requires confirmation
});

// Example of an auto-executing tool
const getCurrentTime = tool({
  description: "Get current server time",
  inputSchema: z.object({}),
  execute: async () => new Date().toISOString()
});
```

To handle tool confirmations, add execution functions to the `executions` object:

```typescript
export const executions = {
  searchDatabase: async ({
    query,
    limit
  }: {
    query: string;
    limit?: number;
  }) => {
    // Implementation for when the tool is confirmed
    const results = await db.search(query, limit);
    return results;
  }
  // Add more execution handlers for other tools that require confirmation
};
```

Tools can be configured in two ways:

1. With an `execute` function for automatic execution
2. Without an `execute` function, requiring confirmation and using the `executions` object to handle the confirmed action. NOTE: The keys in `executions` should match `toolsRequiringConfirmation` in `app.tsx`.

### Use a different AI model provider

The starting [`server.ts`](https://github.com/cloudflare/agents-starter/blob/main/src/server.ts) implementation uses the [`ai-sdk`](https://sdk.vercel.ai/docs/introduction) and the [OpenAI provider](https://sdk.vercel.ai/providers/ai-sdk-providers/openai), but you can use any AI model provider by:

1. Installing an alternative AI provider for the `ai-sdk`, such as the [`workers-ai-provider`](https://sdk.vercel.ai/providers/community-providers/cloudflare-workers-ai) or [`anthropic`](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic) provider:
2. Replacing the AI SDK with the [OpenAI SDK](https://github.com/openai/openai-node)
3. Using the Cloudflare [Workers AI + AI Gateway](https://developers.cloudflare.com/ai-gateway/providers/workersai/#workers-binding) binding API directly

For example, to use the [`workers-ai-provider`](https://sdk.vercel.ai/providers/community-providers/cloudflare-workers-ai), install the package:

```sh
npm install workers-ai-provider
```

Add an `ai` binding to `wrangler.jsonc`:

```jsonc
// rest of file
  "ai": {
    "binding": "AI"
  }
// rest of file
```

Replace the `@ai-sdk/openai` import and usage with the `workers-ai-provider`:

```diff
// server.ts
// Change the imports
- import { openai } from "@ai-sdk/openai";
+ import { createWorkersAI } from 'workers-ai-provider';

// Create a Workers AI instance
+ const workersai = createWorkersAI({ binding: env.AI });

// Use it when calling the streamText method (or other methods)
// from the ai-sdk
- const model = openai("gpt-4o-2024-11-20");
+ const model = workersai("@cf/deepseek-ai/deepseek-r1-distill-qwen-32b")
```

Commit your changes and then run the `agents-starter` as per the rest of this README.

### Modifying the UI

The chat interface is built with React and can be customized in `app.tsx`:

- Modify the theme colors in `styles.css`
- Add new UI components in the chat container
- Customize message rendering and tool confirmation dialogs
- Add new controls to the header

### Example Queries

Try asking Beatsmith AI:

- "Find songs similar to Cruel Summer"
- "Find artists similar to The Weeknd"
- "Search for Taylor Swift on Spotify"
- "Get track information for [song name]"
- "What songs are similar to [track name]?"

### Extending Beatsmith

You can extend Beatsmith AI by:

1. Adding new music-related tools in `tools.ts`
2. Customizing the UI for specific interactions in `app.tsx`
3. Extending the agent's capabilities in `server.ts`
4. Integrating additional music APIs (e.g., Apple Music, YouTube Music)

## Learn More

- [`agents`](https://github.com/cloudflare/agents/blob/main/packages/agents/README.md)
- [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

## License

MIT
