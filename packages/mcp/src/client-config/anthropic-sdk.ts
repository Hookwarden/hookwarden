// Anthropic Agent SDK is programmatic — no canonical config file path.
// The init helper does NOT write here. Plan 23-07's README + docs
// embed this snippet verbatim.

export function getAnthropicSdkSnippet(): string {
  return `import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Audit this webhook handler for missing signature verification...",
  options: {
    mcpServers: {
      hookwarden: {
        command: "npx",
        args: ["-y", "@hookwarden/mcp"],
      },
    },
  },
})) {
  console.log(message);
}
`;
}
