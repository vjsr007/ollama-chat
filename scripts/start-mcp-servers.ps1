# Start All MCP Servers Script
# This script starts all configured MCP servers automatically

Write-Host "Starting MCP Servers..." -ForegroundColor Green

$projectPath = "D:\MyProjects\ollama-chat"
Set-Location $projectPath

# Array to store server processes
$serverProcesses = @()

Write-Host "Starting Filesystem MCP Server..." -ForegroundColor Yellow
$filesystemProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "npx @modelcontextprotocol/server-filesystem `"$projectPath`"" -NoNewWindow -PassThru
$serverProcesses += $filesystemProcess
Write-Host "Filesystem MCP Server started (PID: $($filesystemProcess.Id))" -ForegroundColor Green

Write-Host "Starting GitHub MCP Server..." -ForegroundColor Yellow
$githubProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "npx @modelcontextprotocol/server-github" -NoNewWindow -PassThru
$serverProcesses += $githubProcess
Write-Host "GitHub MCP Server started (PID: $($githubProcess.Id))" -ForegroundColor Green

Write-Host "Starting Puppeteer MCP Server..." -ForegroundColor Yellow
$puppeteerProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "npx @modelcontextprotocol/server-puppeteer" -NoNewWindow -PassThru
$serverProcesses += $puppeteerProcess
Write-Host "Puppeteer MCP Server started (PID: $($puppeteerProcess.Id))" -ForegroundColor Green

Write-Host "Starting Memory MCP Server..." -ForegroundColor Yellow
$memoryProcess = Start-Process -FilePath "cmd" -ArgumentList "/c", "npx @modelcontextprotocol/server-memory" -NoNewWindow -PassThru
$serverProcesses += $memoryProcess
Write-Host "Memory MCP Server started (PID: $($memoryProcess.Id))" -ForegroundColor Green

Write-Host "Starting Copilot Terminal MCP Server..." -ForegroundColor Yellow
$copilotProcess = Start-Process -FilePath "node" -ArgumentList "$projectPath\src\shared\infrastructure\mcp\servers\copilot-terminal-server.js" -NoNewWindow -PassThru
$serverProcesses += $copilotProcess
Write-Host "Copilot Terminal MCP Server started (PID: $($copilotProcess.Id))" -ForegroundColor Green

# Note: Brave Search server is disabled by default (requires API key)
# Uncomment the following lines and add your API key to enable it:
# Write-Host "Starting Brave Search MCP Server..." -ForegroundColor Yellow
# $env:BRAVE_API_KEY = "your-api-key-here"
# $braveProcess = Start-Process -FilePath "npx" -ArgumentList "@modelcontextprotocol/server-brave-search" -NoNewWindow -PassThru
# $serverProcesses += $braveProcess
# Write-Host "Brave Search MCP Server started (PID: $($braveProcess.Id))" -ForegroundColor Green

Write-Host "All MCP Servers started successfully!" -ForegroundColor Green
Write-Host "Total servers running: $($serverProcesses.Count)" -ForegroundColor Cyan

# Create scripts directory if it doesn't exist
$scriptsDir = "$projectPath\scripts"
if (-not (Test-Path $scriptsDir)) {
    New-Item -ItemType Directory -Path $scriptsDir -Force
}

# Save process IDs for later management
$processIds = $serverProcesses | ForEach-Object { $_.Id }
$processIds | Out-File -FilePath "$scriptsDir\mcp-server-pids.txt" -Encoding UTF8

Write-Host "Process IDs saved to scripts\mcp-server-pids.txt" -ForegroundColor Cyan
Write-Host "To stop all servers, run: .\scripts\stop-mcp-servers.ps1" -ForegroundColor Yellow

# Keep the script running to monitor servers
Write-Host "Press Ctrl+C to stop all servers and exit..." -ForegroundColor Magenta

try {
    while ($true) {
        Start-Sleep -Seconds 10
        
        # Check if all processes are still running
        $runningCount = 0
        foreach ($process in $serverProcesses) {
            if (-not $process.HasExited) {
                $runningCount++
            }
        }
        
        Write-Host "Servers running: $runningCount/$($serverProcesses.Count)" -ForegroundColor Cyan
        
        if ($runningCount -eq 0) {
            Write-Host "All servers have stopped. Exiting..." -ForegroundColor Red
            break
        }
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    Write-Host "Stopping all MCP servers..." -ForegroundColor Yellow
    foreach ($process in $serverProcesses) {
        if (-not $process.HasExited) {
            $process.Kill()
            Write-Host "Stopped server PID: $($process.Id)" -ForegroundColor Green
        }
    }
}
