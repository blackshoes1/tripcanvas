# Trip Canvas 정적 서버 (Node/Python 불필요, PowerShell + .NET만 사용)
# 사용법:  powershell -ExecutionPolicy Bypass -File serve.ps1        (기본 포트 8791)
#          powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 8080
# 중지:    이 창에서 Ctrl+C  (또는 창 닫기)
param([int]$Port = 8791, [string]$Root = $PSScriptRoot)

$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon';
  '.webmanifest'='application/manifest+json'
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() }
catch { Write-Host "포트 $Port 를 열 수 없어: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Trip Canvas 서버 실행 중" -ForegroundColor Green
Write-Host "  → http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  루트: $Root"
Write-Host "  (중지: Ctrl+C 또는 이 창 닫기)"
Write-Host ""

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }
    while (($h = $reader.ReadLine()) -ne $null -and $h -ne '') { }   # 헤더 소진

    $rawPath  = ($requestLine -split ' ')[1]
    $pathOnly = ($rawPath -split '\?')[0]
    $rel = [System.Uri]::UnescapeDataString($pathOnly.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $full = Join-Path $Root $rel

    if (Test-Path $full -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $head = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200  /{0}" -f $rel)
    } else {
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $head = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($body, 0, $body.Length)
      Write-Host ("  404  /{0}" -f $rel) -ForegroundColor DarkYellow
    }
    $stream.Flush()
  } catch { }
  finally { $client.Close() }
}
