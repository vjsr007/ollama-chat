# Ollama Chat with MCP Integration

A modern, feature-rich chat application built with Electron, React, and TypeScript that integrates with Ollama for local AI inference and Model Context Protocol (MCP) for extended functionality.

## 🚀 Features

### Core Features
- **Local AI Chat**: Chat with Ollama models running locally on your machine
- **Modern UI**: Clean, responsive interface with tabs for chat and tools
- **Image Support**: Upload and analyze images with vision-capable models
- **Model Selection**: Easy switching between installed Ollama models
- **System Prompts**: Customize AI behavior with custom system prompts

### MCP Integration
- **Filesystem Tools**: Read, write, and navigate files and directories
- **GitHub Integration**: Search repositories, manage issues, create PRs
- **Web Automation**: Use Puppeteer for web scraping and automation
- **Memory System**: Persistent knowledge graph for remembering context
- **Search Capabilities**: Web search integration (with API key)

### Developer Experience
- **TypeScript**: Full type safety throughout the application
- **Clean Architecture**: Domain-driven design with clear separation of concerns
- **Hot Reload**: Development server with instant updates
- **Testing Ready**: Jest configuration for unit testing
- **Linting**: ESLint and Prettier for code quality

## 🛠️ Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Electron, Node.js
- **AI**: Ollama (local inference)
- **Tools**: Model Context Protocol (MCP)
- **Styling**: CSS3 with modern features
- **Testing**: Jest
- **Build**: TypeScript compiler, Vite bundler

## 📋 Prerequisites

### Required
- **Node.js** 18+ and npm
- **Ollama** installed and running locally
- **Compatible AI Model** with tool support (see supported models below)

### Supported Models for MCP Tools
For full MCP functionality, you need a model that supports function calling:

#### Highly Recommended
- `llama3.1` (8b, 70b, 405b) - Excellent tool support
- `qwen2.5` (7b, 14b, 32b, 72b) - Great performance with tools

#### Recommended
- `mistral-nemo` (12b) - Good tool support
- `mistral-large` (123b) - Advanced capabilities

#### Install a compatible model:
```bash
# Best option for most users
ollama pull llama3.1:8b

# Alternative options
ollama pull qwen2.5:7b
ollama pull mistral-nemo
```

## 🚀 Quick Start

### 1. Clone and Install
```bash
git clone <repository-url>
cd ollama-chat
npm install
```

### 2. Setup MCP Servers
```bash
# Install MCP servers globally
npm run mcp:setup
```

### 3. Build and Run
```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

## 🔧 Configuration

### MCP Servers Configuration
The application automatically configures MCP servers on first run. Configuration is stored in `mcp-servers.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/allowed/directory"],
      "enabled": true
    },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "enabled": true
    }
  }
}
```

### Environment Variables (Optional)
Create a `.env` file for additional configuration:
```env
OLLAMA_BASE_URL=http://localhost:11434
BRAVE_API_KEY=your_brave_search_api_key
```

## 🎯 Usage

### Basic Chat
1. Launch the application
2. Select an Ollama model from the dropdown
3. Type your message and press Enter or click Send
4. Use the system prompt field to customize AI behavior

### Using MCP Tools
When using a compatible model (llama3.1, qwen2.5, etc.), the AI can automatically use tools:

#### Filesystem Operations
```
"List files in the current directory"
"Read the content of package.json"
"Create a new file called test.txt with some content"
```

#### GitHub Integration
```
"Search for React repositories on GitHub"
"Show me issues in the microsoft/vscode repository"
"Create a new issue in my repository"
```

#### Web Automation
```
"Take a screenshot of google.com"
"Navigate to GitHub and extract the main navigation links"
```

#### Memory System
```
"Remember that I prefer TypeScript over JavaScript"
"What do you know about my preferences?"
"Store this information: I work on web development projects"
```

### Tools Tab
- View all available MCP tools and their status
- Manually execute tools with custom parameters
- Monitor tool execution results

## 🏗️ Project Structure

```
src/
├── main/                    # Electron main process
│   └── electron-main.ts     # Main entry point, IPC handlers
├── preload/                 # Electron preload scripts
│   └── preload.ts          # Secure API bridge
├── renderer/                # React frontend
│   ├── main.tsx            # React app entry point
│   ├── components/         # React components
│   └── styles.css          # Application styles
└── shared/                  # Shared code
    ├── domain/             # Domain models and interfaces
    │   ├── chat.ts         # Chat-related types
    │   └── mcp.ts          # MCP-related types
    └── infrastructure/     # Implementation layer
        ├── mcp/            # MCP integration
        │   └── McpManager.ts # MCP server management
        └── ollama/         # Ollama integration
            └── OllamaClient.ts # Ollama API client
```

## 🧪 Development

### Available Scripts
```bash
npm run dev          # Development with hot reload
npm run build        # Production build
npm run build:clean  # Clean build directory
npm run test         # Run tests
npm run lint         # Lint code
npm run format       # Format code with Prettier
npm run mcp:setup    # Install MCP servers
```

### Development Workflow
1. Run `npm run dev` for development with hot reload
2. Use `npm run lint` to check code quality
3. Run `npm test` for unit tests
4. Build with `npm run build` before release

## 🐛 Troubleshooting

### Common Issues

#### "Model does not support tools"
- Your current model doesn't support function calling
- Install a compatible model: `ollama pull llama3.1:8b`
- The app will show a warning and work without tools

#### MCP Servers not starting
- Check that Node.js and npm are in your PATH
- Ensure MCP packages are installed: `npm run mcp:setup`
- Check console logs for specific error messages

#### Ollama connection issues
- Verify Ollama is running: `ollama list`
- Check Ollama is accessible at `http://localhost:11434`
- Restart Ollama service if needed

#### Performance issues
- Use smaller models (8b instead of 70b) for better performance
- Limit the number of active MCP servers
- Ensure sufficient RAM for your chosen model

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes and test thoroughly
4. Run linting and tests: `npm run lint && npm test`
5. Commit with clear messages: `git commit -m "feat: add new feature"`
6. Push and create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Ollama](https://ollama.ai/) - Local AI inference
- [Model Context Protocol](https://modelcontextprotocol.io/) - Tool integration standard
- [Electron](https://www.electronjs.org/) - Desktop app framework
- [React](https://reactjs.org/) - Frontend framework
