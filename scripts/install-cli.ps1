# One-command install/repair of the `optiflow` CLI, for PowerShell.
#
# Mirrors install-cli.sh exactly, for machines where bash isn't the shell of
# choice. This is the BOOTSTRAP path: once it has run once, `optiflow update`
# does the same job and you never need this script again.
#
# It exists because getting the CLI onto a machine used to require knowing
# things that each produced an error that looked like a broken build rather
# than a stale path:
#
#   1. `npm install -g github:kristijankopacevic/optiflow-mcp` is BROKEN on
#      npm 11 + Windows. npm symlinks the global install to its own temp git
#      clone (_cacache/tmp/git-clone-XXXX) and then cleans that up, leaving
#      working bin shims that point at nothing:
#        Error: Cannot find module '...\optiflow-mcp\plugin\bin\optiflow'
#      The remote-tarball URL takes npm's ordinary path and works.
#
#   2. Older docs in this repo told users to add a shell alias pointing at
#      the plugin cache, because before the packaging was fixed that was the
#      only working copy. Such an alias/function now shadows every install
#      and pins the user to whatever build the cache holds:
#        error: unknown command 'savings'
#
#   3. `optiflow update` itself was broken on every security-patched Node on
#      Windows: it spawned `npm.cmd` without `shell: true`, which Node's
#      BatBadBut fix (CVE-2024-27980) turns into `EINVAL`. Fixed at the
#      source (src/cli/commands/update.ts) -- this script is what recovers a
#      machine that is stuck on a build from before that fix landed.
#
# Safe to re-run at any time.

$ErrorActionPreference = "Stop"

$Tarball = "https://github.com/kristijankopacevic/optiflow-mcp/archive/refs/heads/master.tar.gz"

Write-Host "==> Removing a stale optiflow function/alias from your PowerShell profile"
$removedAny = $false
foreach ($profilePath in @($PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost) | Select-Object -Unique) {
  if (-not (Test-Path $profilePath)) { continue }
  $content = Get-Content $profilePath -Raw
  if ($content -match '(?im)^\s*(function\s+optiflow\b|Set-Alias\s+optiflow\b)') {
    $backup = "$profilePath.optiflow-backup-$(Get-Date -Format yyyyMMddHHmmss)"
    Copy-Item $profilePath $backup
    $kept = ($content -split "`r?`n") | Where-Object { $_ -notmatch '(?i)^\s*(function\s+optiflow\b|Set-Alias\s+optiflow\b)' }
    Set-Content $profilePath ($kept -join "`n")
    Write-Host "    removed from $profilePath (backup: $backup)"
    $removedAny = $true
  }
}
if (-not $removedAny) { Write-Host "    none found" }

Write-Host "==> Removing any previous global install"
try { npm uninstall -g optiflow-mcp 2>&1 | Out-Null } catch {}

Write-Host "==> Installing from $Tarball"
npm install -g $Tarball
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

Write-Host ""
Write-Host "==> Verifying"
$optiflowCmd = Get-Command optiflow -ErrorAction SilentlyContinue
if (-not $optiflowCmd) {
  $binDir = "$(npm config get prefix)"
  Write-Host "    'optiflow' is not on your PATH."
  Write-Host "    Add npm's global bin directory:"
  Write-Host ""
  Write-Host "      `$env:PATH = `"$binDir;`$env:PATH`""
  Write-Host "      # and add the same line to your PowerShell profile to make it permanent"
  Write-Host ""
  exit 1
}

# `savings` is the newest command, so its presence is a good proxy for "this
# is actually the current build and not something older still on PATH".
& optiflow savings --help *> $null
if ($LASTEXITCODE -eq 0) {
  $version = & optiflow --version
  Write-Host "    optiflow $version - ok"
} else {
  Write-Host "    WARNING: 'optiflow' resolves to an OLD build:"
  Write-Host "      $($optiflowCmd.Source)"
  Write-Host "    Something on PATH is shadowing the install. Open a new PowerShell"
  Write-Host "    window (PowerShell caches command lookups per-session) and re-check."
  exit 1
}

Write-Host ""
Write-Host "Done. Try:"
Write-Host "  optiflow savings --watch"
Write-Host ""
if ($removedAny) {
  Write-Host "A function/alias was removed from your profile, but it may still be active"
  Write-Host "in THIS session -- a script cannot unset one from the session that ran it."
  Write-Host "Open a new PowerShell window to be sure."
  Write-Host ""
}
Write-Host "Note: the CLI only READS the savings ledger. The plugin's hooks WRITE it,"
Write-Host "so update the plugin too (/plugin in Claude Code) or the ledger stays empty."
