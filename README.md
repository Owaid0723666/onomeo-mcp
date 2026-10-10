# onomeo-mcp

An MCP server that lets your coding agent ask other LLMs for a second opinion. It talks to [onomeo](https://onomeo.com/?utm_source=mcp), an OpenAI-compatible API where a rotating set of models (DeepSeek, GLM, Gemini, Mistral and others) is free to call with no credit card.

Typical uses from Claude Code, Cursor, Cline or any other MCP client:

- "Ask DeepSeek to review this diff and tell me what it would change."
- "Send this regex question to three models and compare the answers."
- "Which free models are up right now?"

onomeo is in public beta. Not every feature is guaranteed to work, and feedback is actively collected and very welcome: open an issue here or write to hello@onomeo.com. This server is written and maintained by the operator of onomeo.

## Tools

| Tool | What it does |
|---|---|
| `list_models` | Lists the models served right now, split into free and pay-as-you-go, with the current free call limit. Needs no API key. |
| `ask_model` | Sends a prompt to one model and returns the answer. `model` defaults to `auto`, which picks a healthy free model and reports which one answered. |
| `compare_models` | Sends the same prompt to 2-4 models in parallel and returns the answers side by side. |

## Setup

1. Sign up at [onomeo.com](https://onomeo.com/?utm_source=mcp) and create an API key. No card is required for the free models.
2. Add the server to your client. Node.js 20 or newer is required.

Claude Code:

```sh
claude mcp add onomeo -e ONOMEO_API_KEY=your-key -- npx -y github:Owaid0723666/onomeo-mcp
```

Cursor, Claude Desktop, Cline, Windsurf and other clients that read an `mcpServers` block:

```json
{
  "mcpServers": {
    "onomeo": {
      "command": "npx",
      "args": ["-y", "github:Owaid0723666/onomeo-mcp"],
      "env": { "ONOMEO_API_KEY": "your-key" }
    }
  }
}
```

Claude Desktop: download `onomeo-mcp.mcpb` from the [latest release](https://github.com/Owaid0723666/onomeo-mcp/releases/latest), open it, and paste your key when asked.

## Limits and pricing

Checked on 2026-10-10; `list_models` always returns the live values.

- Free models: 30 calls per 5 hours per account, refilled automatically. One call covers up to 50,000 characters.
- Paid models (Claude, GPT, Grok, Gemini Pro and others): pay-as-you-go from a 5 USD top-up, no subscription.
- `compare_models` uses one call per model.

## Privacy

Free models are served through third-party free tiers, and several of them may use prompts for training. Each model page on onomeo states what is known. Do not send secrets or private code to free models.

## Development

```sh
npm install
npm test                                          # against a local stub
ONOMEO_LIVE=1 ONOMEO_API_KEY=your-key npm test    # one real call to "auto"
```

`ONOMEO_BASE_URL` overrides the API host.

## License

MIT
