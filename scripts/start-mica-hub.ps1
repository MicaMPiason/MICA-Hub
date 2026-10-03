$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $PSScriptRoot "server.mjs"
$appUrl = "http://127.0.0.1:8000/"

function Test-MicaHub {
    try {
        $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 1
        return $response.StatusCode -eq 200 -and $response.Content -match "<title>MICA Hub</title>"
    }
    catch {
        return $false
    }
}

if (-not (Test-MicaHub)) {
    $portInUse = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue

    if ($portInUse) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            "A porta 8000 já está sendo usada por outro programa.",
            "MICA Hub",
            "OK",
            "Warning"
        ) | Out-Null
        exit 1
    }

    $quotedServerScript = '"' + $serverScript + '"'
    Start-Process -FilePath "node" -ArgumentList $quotedServerScript -WorkingDirectory $projectRoot -WindowStyle Hidden

    foreach ($attempt in 1..40) {
        Start-Sleep -Milliseconds 150
        if (Test-MicaHub) { break }
    }
}

if (Test-MicaHub) {
    Start-Process $appUrl
    exit 0
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
    "Não foi possível iniciar o servidor local do MICA Hub.",
    "MICA Hub",
    "OK",
    "Error"
) | Out-Null
exit 1
