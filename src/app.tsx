/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback, use } from "react";
import { useAgent } from "agents/react";
import { isToolUIPart } from "ai";
import { useAgentChat } from "agents/ai-react";
import type { UIMessage } from "@ai-sdk/react";
import type { tools } from "./tools";

// Component imports
import { Button } from "@/components/button/Button";
import { Avatar } from "@/components/avatar/Avatar";
import { Textarea } from "@/components/textarea/Textarea";
import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { ToolInvocationCard } from "@/components/tool-invocation-card/ToolInvocationCard";

// Icon imports
import {
  Moon,
  Robot,
  Sun,
  Trash,
  PaperPlaneTilt,
  Stop
} from "@phosphor-icons/react";

// List of tools that require human confirmation
// NOTE: this should match the tools that don't have execute functions in tools.ts
const toolsRequiringConfirmation: (keyof typeof tools)[] = [
  "getWeatherInformation",
  "searchSpotifyArtist"
];

export default function Chat() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // Check localStorage first, default to light for new design
    const savedTheme = localStorage.getItem("theme");
    return (savedTheme as "dark" | "light") || "light";
  });
  const [textareaHeight, setTextareaHeight] = useState("auto");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Apply theme class on mount and when theme changes
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }

    // Save theme preference to localStorage
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
  };

  const agent = useAgent({
    agent: "chat"
  });

  const [agentInput, setAgentInput] = useState("");
  const handleAgentInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setAgentInput(e.target.value);
  };

  const handleAgentSubmit = async (
    e: React.FormEvent,
    extraData: Record<string, unknown> = {}
  ) => {
    e.preventDefault();
    if (!agentInput.trim()) return;

    const message = agentInput;
    setAgentInput("");

    // Send message to agent
    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: message }]
      },
      {
        body: extraData
      }
    );
  };

  const {
    messages: agentMessages,
    addToolResult,
    clearHistory,
    status,
    sendMessage,
    stop
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({
    agent
  });

  // Auto-send message when user returns from Spotify authentication
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get("auth") === "success";

    if (authSuccess) {
      // Clear the flag from URL so it doesn't repeat
      window.history.replaceState({}, document.title, window.location.pathname);

      // Auto-send message to continue the task
      const autoMessage = "Continue the task";

      sendMessage(
        {
          role: "user",
          parts: [{ type: "text", text: autoMessage }]
        },
        {
          body: { autoTriggered: true }
        }
      );
    }
  }, [sendMessage]);

  // Scroll to bottom when messages change
  useEffect(() => {
    agentMessages.length > 0 && scrollToBottom();
  }, [agentMessages, scrollToBottom]);

  const pendingToolCallConfirmation = agentMessages.some((m: UIMessage) =>
    m.parts?.some(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        // Manual check inside the component
        toolsRequiringConfirmation.includes(
          part.type.replace("tool-", "") as keyof typeof tools
        )
    )
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-[100vh] w-full p-4 flex justify-center items-center bg-fixed overflow-hidden" style={{ background: "var(--gradient-bg)" }}>
      {/* Animated Background Elements */}
      <div className="fixed top-20 left-20 w-64 h-64 bg-blue-400/20 rounded-full blur-3xl animate-float pointer-events-none" />
      <div className="fixed bottom-20 right-20 w-80 h-80 bg-purple-400/20 rounded-full blur-3xl animate-float pointer-events-none" style={{ animationDelay: "-3s" }} />

      <HasOpenAIKey />
      <div className="h-[calc(100vh-2rem)] w-full mx-auto max-w-lg flex flex-col rounded-2xl overflow-hidden relative glass-panel">
        {/* Header */}
        <div className="px-5 py-4 flex items-center gap-3 sticky top-0 z-10 backdrop-blur-md border-b border-white/20" style={{ background: "var(--gradient-primary)" }}>
          <div className="flex items-center justify-center h-10 w-10 bg-white/20 rounded-full backdrop-blur-sm shadow-sm">
            <svg
              width="24px"
              height="24px"
              className="text-white"
              data-icon="agents"
            >
              <title>Cloudflare Agents</title>
              <symbol id="ai:local:agents" viewBox="0 6 90 79">
                <path
                  fill="currentColor"
                  d="M69.3 39.7c-3.1 0-5.8 2.1-6.7 5H48.3V34h4.6l4.5-2.5c1.1.8 2.5 1.2 3.9 1.2 3.8 0 7-3.1 7-7s-3.1-7-7-7-7 3.1-7 7c0 .9.2 1.8.5 2.6L51.9 30h-3.5V18.8h-.1c-1.3-1-2.9-1.6-4.5-1.9h-.2c-1.9-.3-3.9-.1-5.8.6-.4.1-.8.3-1.2.5h-.1c-.1.1-.2.1-.3.2-1.7 1-3 2.4-4 4 0 .1-.1.2-.1.2l-.3.6c0 .1-.1.1-.1.2v.1h-.6c-2.9 0-5.7 1.2-7.7 3.2-2.1 2-3.2 4.8-3.2 7.7 0 .7.1 1.4.2 2.1-1.3.9-2.4 2.1-3.2 3.5s-1.2 2.9-1.4 4.5c-.1 1.6.1 3.2.7 4.7s1.5 2.9 2.6 4c-.8 1.8-1.2 3.7-1.1 5.6 0 1.9.5 3.8 1.4 5.6s2.1 3.2 3.6 4.4c1.3 1 2.7 1.7 4.3 2.2v-.1q2.25.75 4.8.6h.1c0 .1.1.1.1.1.9 1.7 2.3 3 4 4 .1.1.2.1.3.2h.1c.4.2.8.4 1.2.5 1.4.6 3 .8 4.5.7.4 0 .8-.1 1.3-.1h.1c1.6-.3 3.1-.9 4.5-1.9V62.9h3.5l3.1 1.7c-.3.8-.5 1.7-.5 2.6 0 3.8 3.1 7 7 7s7-3.1 7-7-3.1-7-7-7c-1.5 0-2.8.5-3.9 1.2l-4.6-2.5h-4.6V48.7h14.3c.9 2.9 3.5 5 6.7 5 3.8 0 7-3.1 7-7s-3.1-7-7-7m-7.9-16.9c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3m0 41.4c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3M44.3 72c-.4.2-.7.3-1.1.3-.2 0-.4.1-.5.1h-.2c-.9.1-1.7 0-2.6-.3-1-.3-1.9-.9-2.7-1.7-.7-.8-1.3-1.7-1.6-2.7l-.3-1.5v-.7q0-.75.3-1.5c.1-.2.1-.4.2-.7s.3-.6.5-.9c0-.1.1-.1.1-.2.1-.1.1-.2.2-.3s.1-.2.2-.3c0 0 0-.1.1-.1l.6-.6-2.7-3.5c-1.3 1.1-2.3 2.4-2.9 3.9-.2.4-.4.9-.5 1.3v.1c-.1.2-.1.4-.1.6-.3 1.1-.4 2.3-.3 3.4-.3 0-.7 0-1-.1-2.2-.4-4.2-1.5-5.5-3.2-1.4-1.7-2-3.9-1.8-6.1q.15-1.2.6-2.4l.3-.6c.1-.2.2-.4.3-.5 0 0 0-.1.1-.1.4-.7.9-1.3 1.5-1.9 1.6-1.5 3.8-2.3 6-2.3q1.05 0 2.1.3v-4.5c-.7-.1-1.4-.2-2.1-.2-1.8 0-3.5.4-5.2 1.1-.7.3-1.3.6-1.9 1s-1.1.8-1.7 1.3c-.3.2-.5.5-.8.8-.6-.8-1-1.6-1.3-2.6-.2-1-.2-2 0-2.9.2-1 .6-1.9 1.3-2.6.6-.8 1.4-1.4 2.3-1.8l1.8-.9-.7-1.9c-.4-1-.5-2.1-.4-3.1s.5-2.1 1.1-2.9q.9-1.35 2.4-2.1c.9-.5 2-.8 3-.7.5 0 1 .1 1.5.2 1 .2 1.8.7 2.6 1.3s1.4 1.4 1.8 2.3l4.1-1.5c-.9-2-2.3-3.7-4.2-4.9q-.6-.3-.9-.6c.4-.7 1-1.4 1.6-1.9.8-.7 1.8-1.1 2.9-1.3.9-.2 1.7-.1 2.6 0 .4.1.7.2 1.1.3V72zm25-22.3c-1.6 0-3-1.3-3-3 0-1.6 1.3-3 3-3s3 1.3 3 3c0 1.6-1.3 3-3 3"
                />
              </symbol>
              <use href="#ai:local:agents" />
            </svg>
          </div>

          <div className="flex-1 text-white">
            <h2 className="font-bold text-lg">AI Assistant</h2>
            <p className="text-xs text-white/80">Always here to help</p>
          </div>

          {/* Centered Theme Toggle */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Button
              variant="ghost"
              size="md"
              shape="circular"
              className="btn-liquid h-10 w-10 text-white rounded-full flex items-center justify-center backdrop-blur-md bg-white/20 border border-white/30 shadow-lg hover:bg-white/30 hover:scale-105 transition-all duration-300"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={20} weight="fill" /> : <Moon size={20} weight="fill" />}
            </Button>
          </div>

          <div className="flex items-center justify-center mr-2">
            <Button
              variant="ghost"
              size="md"
              shape="square"
              className="btn-liquid h-10 w-10 text-white rounded-full flex items-center justify-center backdrop-blur-md bg-white/20 border border-white/30 shadow-lg hover:bg-white/30 hover:scale-105 transition-all duration-300"
              onClick={clearHistory}
            >
              <Trash size={20} />
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-28 max-h-[calc(100vh-10rem)] scrollbar-hide">
          {agentMessages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <div className="p-8 max-w-md mx-auto glass-bubble-ai rounded-2xl text-center space-y-4">
                <div className="bg-blue-100 text-blue-600 rounded-full p-4 inline-flex shadow-sm">
                  <Robot size={32} />
                </div>
                <h3 className="font-bold text-xl text-neutral-800">Welcome to AI Chat</h3>
                <p className="text-neutral-600">
                  I'm your personal assistant. Ask me anything!
                </p>
                <div className="grid grid-cols-1 gap-2 mt-4">
                  <button onClick={() => setAgentInput("What's the weather in Tokyo?")} className="text-sm p-3 bg-white/50 hover:bg-white/80 rounded-xl text-left transition-colors flex items-center gap-2 text-neutral-700">
                    <span>🌤️</span> Weather in Tokyo
                  </button>
                  <button onClick={() => setAgentInput("Find songs similar to Blinding Lights")} className="text-sm p-3 bg-white/50 hover:bg-white/80 rounded-xl text-left transition-colors flex items-center gap-2 text-neutral-700">
                    <span>🎵</span> Music recommendations
                  </button>
                </div>
              </div>
            </div>
          )}

          {agentMessages.map((m, index) => {
            const isUser = m.role === "user";
            const showAvatar =
              index === 0 || agentMessages[index - 1]?.role !== m.role;

            return (
              <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div
                  className={`flex gap-3 max-w-[85%] ${isUser ? "flex-row-reverse" : "flex-row"
                    }`}
                >
                  {showAvatar && !isUser ? (
                    <Avatar username={"AI"} />
                  ) : (
                    !isUser && <div className="w-8" />
                  )}

                  <div className="flex flex-col gap-1">
                    {m.parts?.map((part, i) => {
                      if (part.type === "text") {
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: immutable index
                          <div key={i} className="group relative">
                            <div
                              className={`p-4 rounded-2xl shadow-sm ${isUser
                                ? "glass-bubble-user rounded-tr-sm"
                                : "glass-bubble-ai rounded-tl-sm"
                                } ${part.text.startsWith("scheduled message")
                                  ? "border-accent/50"
                                  : ""
                                }`}
                            >
                              {part.text.startsWith(
                                "scheduled message"
                              ) && (
                                  <span className="absolute -top-3 -left-2 text-base">
                                    🕒
                                  </span>
                                )}
                              <MemoizedMarkdown
                                id={`${m.id}-${i}`}
                                content={part.text.replace(
                                  /^scheduled message: /,
                                  ""
                                )}
                              />
                            </div>
                            <p
                              className={`text-[10px] text-neutral-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? "text-right" : "text-left"
                                }`}
                            >
                              {formatTime(
                                m.metadata?.createdAt
                                  ? new Date(m.metadata.createdAt)
                                  : new Date()
                              )}
                            </p>
                          </div>
                        );
                      }

                      if (isToolUIPart(part) && m.role === "assistant") {
                        const toolCallId = part.toolCallId;
                        const toolName = part.type.replace("tool-", "");
                        const needsConfirmation =
                          toolsRequiringConfirmation.includes(
                            toolName as keyof typeof tools
                          );

                        return (
                          <div key={`${toolCallId}-${i}`} className="glass-bubble-ai p-2 rounded-xl">
                            <ToolInvocationCard
                              toolUIPart={part}
                              toolCallId={toolCallId}
                              needsConfirmation={needsConfirmation}
                              onSubmit={({ toolCallId, result }) => {
                                addToolResult({
                                  tool: part.type.replace("tool-", ""),
                                  toolCallId,
                                  output: result
                                });
                              }}
                              addToolResult={(toolCallId, result) => {
                                addToolResult({
                                  tool: part.type.replace("tool-", ""),
                                  toolCallId,
                                  output: result
                                });
                              }}
                            />
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="absolute bottom-4 left-4 right-4 z-20">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAgentSubmit(e, {
                annotations: {
                  hello: "world"
                }
              });
              setTextareaHeight("auto"); // Reset height after submission
            }}
            className="relative"
          >
            <div className="glass-input rounded-3xl p-1 flex items-end gap-2 pr-2">
              <Textarea
                disabled={pendingToolCallConfirmation}
                placeholder={
                  pendingToolCallConfirmation
                    ? "Please respond to the tool confirmation above..."
                    : "Type a message..."
                }
                className="flex-1 bg-transparent border-none px-4 py-3 focus:ring-0 text-base placeholder:text-neutral-400 min-h-[48px] max-h-[120px] resize-none text-neutral-800 dark:text-white"
                value={agentInput}
                onChange={(e) => {
                  handleAgentInputChange(e);
                  // Auto-resize the textarea
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                  setTextareaHeight(`${e.target.scrollHeight}px`);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    handleAgentSubmit(e as unknown as React.FormEvent);
                    setTextareaHeight("auto"); // Reset height on Enter submission
                  }
                }}
                rows={1}
                style={{ height: textareaHeight }}
              />

              <div className="pb-1.5">
                {status === "submitted" || status === "streaming" ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="h-10 w-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shadow-md"
                    aria-label="Stop generation"
                  >
                    <Stop size={20} weight="bold" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="h-10 w-10 flex items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={pendingToolCallConfirmation || !agentInput.trim()}
                    aria-label="Send message"
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    <PaperPlaneTilt size={20} weight="fill" />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const hasOpenAiKeyPromise = fetch("/check-open-ai-key").then((res) =>
  res.json<{ success: boolean }>()
);

function HasOpenAIKey() {
  const hasOpenAiKey = use(hasOpenAiKeyPromise);

  if (!hasOpenAiKey.success) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/10 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-lg border border-red-200 dark:border-red-900 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-labelledby="warningIcon"
                >
                  <title id="warningIcon">Warning Icon</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
                  OpenAI API Key Not Configured
                </h3>
                <p className="text-neutral-600 dark:text-neutral-300 mb-1">
                  Requests to the API, including from the frontend UI, will not
                  work until an OpenAI API key is configured.
                </p>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Please configure an OpenAI API key by setting a{" "}
                  <a
                    href="https://developers.cloudflare.com/workers/configuration/secrets/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 dark:text-red-400"
                  >
                    secret
                  </a>{" "}
                  named{" "}
                  <code className="bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 font-mono text-sm">
                    OPENAI_API_KEY
                  </code>
                  . <br />
                  You can also use a different model provider by following these{" "}
                  <a
                    href="https://github.com/cloudflare/agents-starter?tab=readme-ov-file#use-a-different-ai-model-provider"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 dark:text-red-400"
                  >
                    instructions.
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
