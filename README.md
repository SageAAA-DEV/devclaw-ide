# DevClaw IDE

A developer-first IDE powered by AI agents. Built on Code-OSS with deep [OpenClaw](https://github.com/bsci83/devclaw-oss) gateway integration.

DevClaw gives solo developers and small teams an entire AI-powered development team — agents for coding, debugging, testing, deployment, and project management — all inside one editor.

## Features

- **AI Agent Team** — Multiple specialized agents collaborate on your codebase
- **OpenClaw Gateway** — Real-time WebSocket connection to your local or cloud agent infrastructure
- **Built-in Browser Tools** — Page inspection, screenshots, and console access for agents
- **Privacy-First** — Telemetry is off by default. Your code never leaves your machine unless you choose to share it.
- **No Copilot Lock-in** — Bring your own AI provider. GitHub Copilot extensions are blocked by default.

## Getting Started

### Prerequisites

- Node.js >= 20
- Python 3 (for native modules)
- Git

### Build from Source

```bash
git clone https://github.com/bsci83/devclaw-oss.git
cd devclaw-oss
npm install
npm run watch
```

Then launch with:

```bash
./scripts/code.sh   # macOS/Linux
scripts\code.bat     # Windows
```

### OpenClaw Gateway

DevClaw connects to an OpenClaw gateway on `localhost:18789` by default. To change this, go to **Settings > DevTeam > OpenClaw** and update the host/port.

## Architecture

DevClaw extends VS Code's workbench with a `devteam` contribution that adds:

- **Gateway Panel** — Live connection to OpenClaw with RPC sections for agents, skills, tools, sessions, models, and more
- **Chat Pane** — Streaming AI chat with code-apply support
- **Settings Pane** — Configure Git, Database, MCP servers, and API keys
- **Privacy Consent** — First-run dialog that respects your choices

See the [VS Code architecture docs](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) for the underlying platform.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE.txt)

DevClaw is a fork of [Code - OSS](https://github.com/microsoft/vscode) by Microsoft, released under the MIT License.
