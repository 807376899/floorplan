$ErrorActionPreference = "Stop"

$dockerBin = "D:\Docker\DockerDesktop\resources\bin\docker.exe"
$dockerDesktop = "D:\Docker\DockerDesktop\Docker Desktop.exe"

if (-not (Test-Path $dockerBin)) {
  throw "Docker CLI not found at $dockerBin"
}

try {
  & $dockerBin info *> $null
} catch {
  if (Test-Path $dockerDesktop) {
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    Write-Host "Waiting for Docker Desktop..."
    for ($i = 1; $i -le 60; $i++) {
      Start-Sleep -Seconds 3
      try {
        & $dockerBin info *> $null
        break
      } catch {
        if ($i -eq 60) { throw "Docker Desktop did not become ready in time." }
      }
    }
  } else {
    throw
  }
}

& $dockerBin compose up -d --build
& $dockerBin compose ps
