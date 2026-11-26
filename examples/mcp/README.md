# Connect an AI agent over MCP

The MCP address is `https://your-nest-deploy/api/mcp`. Replace it and `ndp_...` with your own address and token.

- `cursor.json`: add it to Cursor's MCP settings (`~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project).
- `claude-desktop.json`: add it to Claude Desktop's `claude_desktop_config.json`. Claude Desktop starts local programs, so this uses the third-party `mcp-remote` bridge to reach an HTTP address.
- `claude-code.json`: the same server for Claude Code, which connects over HTTP directly.

**Token scopes:** whatever you want the agent to do. `get_me` needs none and is the best first call: it lists the scopes the token has. For a read-only agent tick only the `:read` permissions. Tools that change things are marked, and an agent should use them only when you ask.

These config files hold a placeholder token. Do not commit a real one.
