# Configure Copilot Terminal
# This script sets up copilot-terminal with optimal settings

Write-Host "Configuring Copilot Terminal..." -ForegroundColor Green

# Create config directory if it doesn't exist
$configDir = "$env:USERPROFILE\.copilot-terminal"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force
    Write-Host "Created config directory: $configDir" -ForegroundColor Yellow
}

# Create configuration file
$configFile = "$configDir\config.json"
$config = @{
    "model" = "qwen2.5:latest"
    "temperature" = 0.3
    "max_tokens" = 1000
    "context_length" = 4096
    "stream" = $true
    "auto_execute" = $false
    "show_suggestions" = $true
    "history_file" = "$configDir\history.txt"
    "prompt_template" = "You are a helpful terminal assistant. Provide concise, accurate command suggestions for Windows PowerShell. Context: {context}"
} | ConvertTo-Json -Depth 10

$config | Out-File -FilePath $configFile -Encoding UTF8
Write-Host "Configuration saved to: $configFile" -ForegroundColor Green

# Create alias for easy access
$profilePath = $PROFILE
if (-not (Test-Path $profilePath)) {
    New-Item -ItemType File -Path $profilePath -Force
    Write-Host "Created PowerShell profile: $profilePath" -ForegroundColor Yellow
}

$aliasCommand = @"

# Copilot Terminal Aliases
Set-Alias -Name ct -Value copilot-terminal
Set-Alias -Name cop -Value copilot-terminal

# MCP Server Management Aliases
function Start-MCPServers { & "D:\MyProjects\ollama-chat\scripts\start-mcp-servers.ps1" }
function Stop-MCPServers { & "D:\MyProjects\ollama-chat\scripts\stop-mcp-servers.ps1" }

Set-Alias -Name start-mcp -Value Start-MCPServers
Set-Alias -Name stop-mcp -Value Stop-MCPServers

Write-Host "Copilot Terminal configured! Use 'ct' or 'cop' to start" -ForegroundColor Green
Write-Host "MCP Servers: Use 'start-mcp' or 'stop-mcp'" -ForegroundColor Cyan

"@

Add-Content -Path $profilePath -Value $aliasCommand
Write-Host "Added aliases to PowerShell profile" -ForegroundColor Green

Write-Host "Copilot Terminal configuration complete!" -ForegroundColor Green
Write-Host "Available commands:" -ForegroundColor Cyan
Write-Host "   ct / cop          - Start Copilot Terminal" -ForegroundColor White
Write-Host "   start-mcp         - Start all MCP servers" -ForegroundColor White
Write-Host "   stop-mcp          - Stop all MCP servers" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "Restart PowerShell to activate aliases, or run:" -ForegroundColor Yellow
Write-Host "   . $PROFILE" -ForegroundColor White
