# One-click launcher for the IPMS dashboard (production mode).
#   - If the site is already running on the port, just opens the browser.
#   - Rebuilds only when the source is newer than the last build.
#   - Binds to 127.0.0.1 only (this PC; also avoids a Windows Firewall prompt).
# Keep this window open while using the site - closing it stops the server.
# Console messages are intentionally English: Hebrew renders reversed/garbled
# in the classic Windows console.
param(
  [int]$Port = 3000,
  [switch]$NoBrowser,   # for automated tests
  [switch]$NoPause      # for automated tests
)

$ErrorActionPreference = "Stop"
# Keep a log of the last run next to the script so a window that closes too fast can still be diagnosed.
try { Start-Transcript -Path (Join-Path $PSScriptRoot "launcher.log") -Force | Out-Null } catch {}
$Host.UI.RawUI.WindowTitle = "IPMS - local server (keep open)"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$url = "http://localhost:$Port"

function Pause-IfInteractive {
  if (-not $NoPause) { Read-Host "Press Enter to close this window" | Out-Null }
}
function Fail([string]$msg) {
  Write-Host ""
  Write-Host "ERROR: $msg" -ForegroundColor Red
  Pause-IfInteractive
  exit 1
}
# Picks the browser to open the site in. The Windows default is used only if its
# registered handler really exists - a default left pointing at an uninstalled
# browser (e.g. a removed Firefox) makes Start-Process <url> silently open
# nothing. Falls back to Chrome, then Edge. Returns $null to mean "use default".
function Get-BrowserLauncher {
  try {
    $progId = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice" -ErrorAction Stop).ProgId
    $cmd = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction Stop).'(default)'
    if ($cmd -match '^"([^"]+)"') { $exe = $Matches[1] } else { $exe = ($cmd -split ' ')[0] }
    if ($exe -and (Test-Path $exe)) { return $null }
  } catch { return $null }   # can't tell - let Windows decide
  $candidates = @(
    @{ Name = "Chrome"; Paths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
    @{ Name = "Edge";   Paths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") }
  )
  foreach ($c in $candidates) {
    $found = $c.Paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($found) { return @{ Name = $c.Name; Exe = $found } }
  }
  return $null
}
function Open-Url([string]$target) {
  $b = Get-BrowserLauncher
  if ($b) {
    Write-Host "Your default browser is not available - opening in $($b.Name) instead." -ForegroundColor Yellow
    Start-Process -FilePath $b.Exe -ArgumentList $target
  } else {
    Start-Process $target
  }
}
function Test-PortOpen([int]$p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $p, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(500)) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch { return $false } finally { $client.Close() }
}

# Any unexpected error: show it and keep the window open instead of vanishing.
trap { Fail ("Unexpected error: " + $_.Exception.Message + " (script line " + $_.InvocationInfo.ScriptLineNumber + ")") }

# 1. Already running? Just open it.
if (Test-PortOpen $Port) {
  Write-Host "IPMS is already running at $url" -ForegroundColor Green
  if (-not $NoBrowser) { Open-Url $url }
  exit 0
}

# 2. Prerequisites.
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "Node.js/npm was not found on this PC. Install Node.js and try again." }
if (-not (Test-Path (Join-Path $root ".env.local"))) { Fail ".env.local is missing in $root (it holds SESSION_SECRET and the API keys)." }
if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Host "First run: installing dependencies..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed - see the messages above." }
}

# 3. Build only if there is no build yet, or the source changed since the last one.
$buildId = Join-Path $root ".next\BUILD_ID"
$needBuild = -not (Test-Path $buildId)
if (-not $needBuild) {
  $builtAt = (Get-Item $buildId).LastWriteTime
  $watched = @(Get-ChildItem -Path (Join-Path $root "src") -Recurse -File -ErrorAction SilentlyContinue)
  foreach ($name in "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "next.config.mjs", "next.config.js") {
    $f = Join-Path $root $name
    if (Test-Path $f) { $watched += Get-Item $f }
  }
  $needBuild = [bool]($watched | Where-Object { $_.LastWriteTime -gt $builtAt } | Select-Object -First 1)
}
if ($needBuild) {
  Write-Host "Building the site (about 20-40 seconds)..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "The build failed - see the messages above. The site was not started." }
}

# 4. Start the server in this window.
Write-Host "Starting IPMS..." -ForegroundColor Cyan
# The server's own output (production errors are redacted in the browser, so this
# log is the only place the real cause shows up) goes to launcher\server.log.
$serverLog = Join-Path $PSScriptRoot "server.log"
if ((Test-Path $serverLog) -and ((Get-Item $serverLog).Length -gt 5MB)) { Move-Item $serverLog "$serverLog.old" -Force }
Write-Host "Server log: $serverLog" -ForegroundColor DarkGray
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start -- -p $Port -H 127.0.0.1 >> `"$serverLog`" 2>&1" `
  -WorkingDirectory $root -NoNewWindow -PassThru

$deadline = (Get-Date).AddSeconds(90)
while (-not (Test-PortOpen $Port)) {
  if ($proc.HasExited) { Fail "The server stopped right after starting - see the messages above." }
  if ((Get-Date) -gt $deadline) { Fail "The server did not become ready within 90 seconds." }
  Start-Sleep -Milliseconds 400
}

Write-Host ""
Write-Host "IPMS is running at $url" -ForegroundColor Green
Write-Host "Keep this window open while you use the site. Close it to stop the server." -ForegroundColor Yellow
if (-not $NoBrowser) { Open-Url $url }

$proc.WaitForExit()
Write-Host ""
Write-Host "The server has stopped." -ForegroundColor Yellow
Pause-IfInteractive
