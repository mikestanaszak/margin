# Install or replace Margin on Windows.
# Usage: irm https://raw.githubusercontent.com/mikestanaszak/margin/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repository = if ($env:MARGIN_REPOSITORY) { $env:MARGIN_REPOSITORY } else { "mikestanaszak/margin" }
$version = if ($env:MARGIN_VERSION) { $env:MARGIN_VERSION } else { "latest" }
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("margin-" + [guid]::NewGuid())

try {
    $releaseEndpoint = if ($version -eq "latest") {
        "https://api.github.com/repos/$repository/releases/latest"
    } else {
        "https://api.github.com/repos/$repository/releases/tags/v$version"
    }
    $release = Invoke-RestMethod -Uri $releaseEndpoint -Headers @{ Accept = "application/vnd.github+json" }
    $installer = $release.assets | Where-Object { $_.name -match "_x64-setup\.exe$" } | Select-Object -First 1
    if (-not $installer) { throw "The release has no Windows installer." }

    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
    $installerPath = Join-Path $temporaryDirectory $installer.name
    Write-Host "Downloading Margin..."
    Invoke-WebRequest -Uri $installer.browser_download_url -OutFile $installerPath

    # An executable in use cannot be replaced on Windows. Closing Margin here
    # lets the installer replace an older installation in one pass.
    Get-Process -Name "Margin" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction Stop

    $process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Margin installer exited with code $($process.ExitCode)." }

    Write-Host "Installed Margin $($release.tag_name)."
    Write-Host "Your existing Margin installation was replaced."
} finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
