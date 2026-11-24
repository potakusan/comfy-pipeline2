# 起動用 bat から呼ばれる。「コードを直したのに古いまま動いている」を防ぐ。
#   - ソース(app / components / lib / public / scripts / 設定ファイル)が、ビルド(.next\BUILD_ID)より新しければ「要ビルド」。
#   - 待ち受け中のサーバーが、最新のビルドより前に起動したものなら古いので、そのウィンドウごと止める。
# 終了コード: 0 = そのまま使える / 2 = 要ビルド(古いサーバーは止めた) / 3 = ビルドは新しい(古いサーバーは止めた)
param(
  [int]$Port = 3100,
  [Parameter(Mandatory = $true)][string]$Dir
)
$ErrorActionPreference = "Stop"
$buildId = Join-Path $Dir ".next\BUILD_ID"
$hasBuild = Test-Path $buildId
$buildTime = if ($hasBuild) { (Get-Item $buildId).LastWriteTime } else { [datetime]::MinValue }

$roots = "app", "components", "lib", "public", "scripts"
$files = foreach ($r in $roots) { $p = Join-Path $Dir $r; if (Test-Path $p) { Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue } }
$files += foreach ($f in "next.config.ts", "package.json", "tsconfig.json", "postcss.config.mjs") { $p = Join-Path $Dir $f; if (Test-Path $p) { Get-Item $p } }
# ビルド時に更新される生成物は除く
$files = $files | Where-Object { $_.Name -ne "next-env.d.ts" -and $_.FullName -notmatch "\\data\\" }
$newest = ($files | Measure-Object LastWriteTime -Maximum).Maximum
$needBuild = (-not $hasBuild) -or ($newest -gt $buildTime)

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$stopped = $false
if ($listener) {
  $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  $oldServer = $proc -and $hasBuild -and ($proc.StartTime -lt $buildTime)
  if ($needBuild -or $oldServer) {
    # 待ち受けているプロセスから親をたどり、起動ウィンドウ(cmd /k)ごと止める。
    # 起動用 bat 自身(cmd /c ... .bat)や、その先の ComfyUI のウィンドウまで巻き込まないよう、「cmd /k」に着いたらそこで止まる。
    $top = $listener.OwningProcess
    $cur = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    while ($cur) {
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($cur.ParentProcessId)" -ErrorAction SilentlyContinue
      if (-not $parent) { break }
      if ($parent.Name -eq "cmd.exe" -and $parent.CommandLine -match "\s/k\s") { $top = $parent.ProcessId; break }
      if ($parent.Name -in @("cmd.exe", "node.exe", "pnpm.exe") -and $parent.CommandLine -notmatch "\.bat") { $top = $parent.ProcessId; $cur = $parent } else { break }
    }
    taskkill /T /F /PID $top | Out-Null
    Start-Sleep -Seconds 2
    $stopped = $true
    Write-Host "stopped the old server on port $Port"
  }
}

if ($needBuild) { exit 2 }
if ($stopped) { exit 3 }
exit 0
