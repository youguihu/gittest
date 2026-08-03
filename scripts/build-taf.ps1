param(
    [string]$OutputDir = "dist"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$required = @(
    "bin\www",
    "package.json",
    "server\app.js",
    "server\TradeLogQueryServer.conf",
    "server\client\public\index.html"
)
foreach ($f in $required) {
    if (-not (Test-Path -LiteralPath $f)) {
        Write-Error "缺少必需文件: $f"
        exit 1
    }
}

$hash = (git rev-parse --short HEAD 2>$null)
if (-not $hash) { $hash = "nogit" }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $Root $OutputDir
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$out = Join-Path $outDir "tradelogqueryserver-$hash-$stamp.tgz"

$excludes = @(
    ".git", ".idea", "dist", "data", "server.log", "server.err.log",
    "scripts\build-taf.ps1", "scripts\build-taf.sh"
)
$args = @("-czf", $out)
foreach ($e in $excludes) { $args += @("--exclude=$e") }
$args += @("bin", "package.json", "package-lock.json", "server")

tar @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "打包完成: $out"
Write-Output "包大小: $([Math]::Round((Get-Item $out).Length / 1MB, 2)) MB"
Write-Output "--- 包内顶层结构 ---"
tar -tzf $out | ForEach-Object { ($_ -split "/")[0] } | Sort-Object -Unique
