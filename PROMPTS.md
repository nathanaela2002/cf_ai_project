# AI Prompts Used in Beatsmith AI Development

This document contains all the AI prompts used during the development of Beatsmith AI. AI-assisted coding was used throughout the project to implement features, debug issues, and optimize the codebase.

## Table of Contents
1. [Spotify Login & Authentication Implementation](#spotify-login--authentication-implementation)
2. [Missing Function Implementation](#missing-function-implementation)
3. [Frontend-Backend Coordination](#frontend-backend-coordination)
4. [Similar Songs & Music Recommendations](#similar-songs--music-recommendations)
5. [Deployment & Cloudflare Workers Issues](#deployment--cloudflare-workers-issues)
6. [UI & Frontend Updates](#ui--frontend-updates)

---

## Spotify Login & Authentication Implementation

### Step-by-Step Login Tool Implementation
- "Create a login to spotify tool slowly implement one by one as I tell you to to avoid errors and see whats possible. All I want is for you to add a tool so that the agent sends this link to the user when it is time to login basically when the user asks about spotify it needs to login first this the link: [Spotify authorization URL]"

### OAuth Flow Questions
- "Is this Spotify authorization link a one-time use?"
- "How can I reuse the Spotify authorization link every time instead of it always giving me the same code?"
- "How do I redo the Spotify login flow so it works for any user, not just one account?"
- "Is it possible to implement a full OAuth flow with callbacks, token storage, sessions, and refresh handling using a Cloudflare AI agent?"
- "How does the OAuth callback actually work, and how is it different from the earlier flow you described?"
- "What exactly is a callback, how does it work, and how can I see if it's firing correctly?"

### Authentication State Management
- "Does this Spotify authorize link only work once? Every time I log in I can only call one API; doing it twice requires me to log in again."
- "Why does my app require re-login for multiple Spotify API calls, and how should token reuse/refresh be handled?"
- "Why can't the AI automatically detect that I logged in to Spotify?"
- "Why is the AI unable to retrieve or reuse the authorization code after login?"
- "Why does Spotify return invalid_grant when the AI tries to exchange the authorization code?"
- "Why doesn't storing the authorization code in memory work across requests?"
- "What is the correct way to persist Spotify auth state so the AI can use it?"

### OAuth Implementation Debugging
- "What is wrong with my Spotify OAuth implementation if the authorize URL redirects with a code but the AI says I'm not logged in?"
- "Am I logged in to Spotify right now?"
- "Can curl commands trigger or test the Spotify OAuth callback?"
- "Provide me the curl commands to manually test the spotify OAuth login process"
- "How can I test whether my callback endpoint is actually working?"

### Spotify App Configuration
- "Is the Spotify 'User Management' tester list required for OAuth to work in development mode?"

### KV Storage & Persistence
- "What is the purpose of the KV namespace ID, and is it a placeholder or a real value?"

---

## Missing Function Implementation

### Function Implementation
- "Implement these functions to the tools and ensure the chat model knows which tools they have so add it to the prompting too"

---

## Frontend-Backend Coordination

### Triggering Logic
- "Look at how this code is auto-run on refresh. I want it to instead run when the user authenticates and the app catches that."

### Authentication Flow Behavior
- "Grep and glop I want the app to automatically continue the task once the user authenticates, not on page refresh."
- "How do I resume the agent flow automatically after Spotify authentication?"
- "How can I trigger an automatic agent message when authentication completes instead of using a refresh-based effect?"

### State-Driven Execution
- "Why does the callback only work on my deployed domain and not locally?"
- "Why don't my localhost redirect URIs return the Spotify authorization code?"

---

## Similar Songs & Music Recommendations

### Recommendation Quality Issues
- "The LLM is overtuned to 'happy' instead of being similar to 'her' by JVKE. How can I get songs that are actually similar if I don't have audio features? How can it find songs by feel or beat instead of title keywords?"

### Alternative APIs & Data Sources
- "Is there an alternative API I can use to get audio features?"
- "Even if I get BPM or key information, how can I find other songs with that data? Is there a way to search by BPM or key?"
- "So would I need to manually find a bunch of random songs?"

---

## Deployment & Cloudflare Workers Issues

### Deployment Configuration
- "Why can't I access callbacks when using a deployed domain instead of local?"
- "Why does Spotify return 'INVALID_CLIENT: Invalid redirect URI'?"
- "How do I find the correct Cloudflare Workers URL to use as my Spotify redirect URI?"

---

## UI & Frontend Updates

### Welcome Page Updates
- "Edit the front page to reflect the functions that are available instead of asking about weather. And specifically say which ones are log in requirement and have a statement at the top saying spotify login system has been deprecated etc"
- "The deprecated function styles should also look like the no login required ones"