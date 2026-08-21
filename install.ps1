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
    if ($release.tag_name -notmatch '^v?(\d+\.\d+\.\d+)$') {
        throw "The release tag does not contain a supported Margin version."
    }
    $releaseVersion = $Matches[1]
    $expectedInstallerName = "Margin_${releaseVersion}_x64-setup.exe"
    $installers = @($release.assets | Where-Object { $_.name -ceq $expectedInstallerName })
    if ($installers.Count -ne 1) { throw "The release must contain exactly one $expectedInstallerName asset." }
    $installer = $installers[0]
    $checksumManifests = @($release.assets | Where-Object { $_.name -ceq "SHA256SUMS" })
    if ($checksumManifests.Count -ne 1) { throw "The release must contain exactly one SHA-256 checksum manifest." }
    $checksumManifest = $checksumManifests[0]

    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
    $installerPath = Join-Path $temporaryDirectory $installer.name
    $checksumPath = Join-Path $temporaryDirectory "SHA256SUMS"
    Write-Host "Downloading Margin..."
    Invoke-WebRequest -Uri $installer.browser_download_url -OutFile $installerPath
    Invoke-WebRequest -Uri $checksumManifest.browser_download_url -OutFile $checksumPath

    $expectedHashes = @()
    foreach ($line in Get-Content -LiteralPath $checksumPath) {
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') {
            throw "The release checksum manifest is malformed."
        }
        $checksumName = $Matches[2]
        if ($checksumName -match '[\\/\x00-\x1f\x7f]') {
            throw "The release checksum manifest contains an unsafe filename."
        }
        if ($checksumName -eq $installer.name) {
            $expectedHashes += $Matches[1]
        }
    }
    if ($expectedHashes.Count -ne 1) {
        throw "The release checksum manifest does not contain exactly one entry for $($installer.name)."
    }
    $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHashes[0]) {
        throw "The Windows installer failed SHA-256 verification."
    }

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
