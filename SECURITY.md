# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DevClaw, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@sageaaa.com** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Impact assessment (what an attacker could achieve)
4. Any suggested fix (optional)

We will acknowledge your report within 48 hours and aim to provide a fix or mitigation within 7 days for critical issues.

## Scope

This policy covers:

- The DevClaw IDE application (this repository)
- Built-in extensions shipped with DevClaw (`extensions/devclaw-*`)
- The OpenClaw gateway integration layer

This policy does **not** cover:

- The upstream Code-OSS / VS Code platform (report those to [Microsoft](https://aka.ms/SECURITY.md))
- Third-party extensions installed by users
- Your own OpenClaw gateway deployment

## Security Design

- **Telemetry is off by default** — No data leaves your machine unless you opt in
- **No hardcoded secrets** — API keys are stored in user-local application storage
- **Copilot blocked** — GitHub Copilot extensions cannot be imported
- **Path traversal protection** — Agent code-apply operations are sandboxed to the workspace
- **Local-first** — The OpenClaw gateway runs on localhost by default

## Best Practices for Users

- Do not share your `.devclaw/` config directory — it may contain API keys
- Secure your local OpenClaw gateway if exposing it beyond localhost
- Review agent-generated code before applying to sensitive files
