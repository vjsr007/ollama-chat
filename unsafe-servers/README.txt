This folder contains high-risk MCP server entrypoints that are packaged disabled-by-default.
They expose powerful system capabilities:
- system-access-server.js: unrestricted file system and command execution
- process-control-server.js: process/service management

These are copies (or symlink targets) of source files under src/shared/infrastructure/mcp/servers.
During build you can keep them synchronized manually.
