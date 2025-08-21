# Stop All MCP Servers Script
# This script stops all running MCP servers

Write-Host "Stopping MCP Servers..." -ForegroundColor Red

$projectPath = "D:\MyProjects\ollama-chat"
$pidsFile = "$projectPath\scripts\mcp-server-pids.txt"

if (Test-Path $pidsFile) {
    Write-Host "Reading process IDs from file..." -ForegroundColor Yellow
    $processIds = Get-Content $pidsFile
    
    $stoppedCount = 0
    foreach ($processId in $processIds) {
        try {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($process) {
                Stop-Process -Id $processId -Force
                Write-Host "Stopped server PID: $processId" -ForegroundColor Green
                $stoppedCount++
            } else {
                Write-Host "Process $processId not found (already stopped)" -ForegroundColor Yellow
            }
        } catch {
            Write-Host "Error stopping process $processId : $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    Write-Host "Stopped $stoppedCount servers" -ForegroundColor Green
    
    # Clean up the PID file
    Remove-Item $pidsFile -ErrorAction SilentlyContinue
    Write-Host "Cleaned up PID file" -ForegroundColor Cyan
} else {
    Write-Host "No PID file found. Attempting to stop all MCP-related processes..." -ForegroundColor Yellow
    
    # Fallback: try to find and stop processes running MCP servers
    $mcpProcesses = Get-Process | Where-Object { 
        $_.ProcessName -eq "node" -and 
        $_.CommandLine -like "*modelcontextprotocol*" 
    }
    
    if ($mcpProcesses) {
        foreach ($process in $mcpProcesses) {
            try {
                Stop-Process -Id $process.Id -Force
                Write-Host "Stopped MCP process PID: $($process.Id)" -ForegroundColor Green
            } catch {
                Write-Host "Error stopping process $($process.Id): $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "No MCP server processes found running" -ForegroundColor Cyan
    }
}

Write-Host "MCP server shutdown complete" -ForegroundColor Green
