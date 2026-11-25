# Phone over USB (MTP / Apple): the phone as Explorer sees it under "This PC".
# Modes:
#   import -Device <name> -Dest <folder> -Known <file>   copy new photos and videos (DCIM, Screenshots) to Dest
#   send   -Device <name> -List <file>                    copy the files listed in List (one path per line) to the phone's Download
# Progress is printed as JSON lines: {"total":N,"bytes":B} {"file":"x.jpg","size":S,"i":k} {"done":k} {"error":"..."}
param([string]$Mode, [string]$Device, [string]$Dest, [string]$Known, [string]$List, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

$sh = New-Object -ComObject Shell.Application
$dev = $null
foreach ($i in $sh.Namespace(17).Items()) { if ($i.Name -eq $Device -and -not $i.IsFileSystem) { $dev = $i; break } }
if (-not $dev) { Say @{ error = 'nodevice' }; exit 1 }
$storages = @($dev.GetFolder.Items() | Where-Object { $_.IsFolder })
if (-not $storages.Count) { Say @{ error = 'locked' }; exit 1 }

function Size($item) { try { $s = $item.ExtendedProperty('System.Size'); if ($s) { return [int64]$s } } catch {} ; try { return [int64]$item.Size } catch { return 0 } }
function Child($folder, $name) { foreach ($x in $folder.GetFolder.Items()) { if ($x.IsFolder -and $x.Name -ieq $name) { return $x } } return $null }

# wait until a copied file has landed: Shell's CopyHere returns at once and copies in the background.
# The name is matched without its extension: an iPhone converts HEIC photos to JPG while copying,
# so the file arrives with another extension and another size. Settled = same size twice in a row.
function WaitFile($dir, $name, [int]$limit) {
    $base = [IO.Path]::GetFileNameWithoutExtension($name)
    $t0 = Get-Date; $lastLen = -1
    while (((Get-Date) - $t0).TotalSeconds -lt $limit) {
        $f = Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -ieq $base -and $_.Extension -notmatch 'tmp|part' } | Select-Object -First 1
        if ($f) {
            if ($f.Length -gt 0 -and $f.Length -eq $lastLen) { return $f }
            $lastLen = $f.Length
        }
        Start-Sleep -Milliseconds 300
    }
    return $null
}

if ($Mode -eq 'import') {
    $seen = @{}
    if ($Known -and (Test-Path -LiteralPath $Known)) { foreach ($l in [IO.File]::ReadAllLines($Known)) { $seen[$l] = 1 } }
    $media = '\.(jpe?g|png|heic|heif|gif|webp|dng|mp4|mov|m4v|3gp|avi|mkv)$'
    $found = New-Object System.Collections.ArrayList
    function Walk($folder, $depth) {
        if ($depth -gt 4) { return }
        foreach ($x in $folder.GetFolder.Items()) {
            if ($x.IsFolder) { if ($x.Name -notmatch '^\.|thumbnails|cache') { Walk $x ($depth + 1) } }
            elseif ($x.Name -match $media) { [void]$found.Add($x) }
        }
    }
    # which months to look at: the Known file remembers the month of the last import ("#last:YYYYMM");
    # the very first import takes the last 2 months only (an iPhone can hold years of photos)
    $lastMonth = $null
    foreach ($k in $seen.Keys) { if ($k -match '^#last:(\d{6})$') { $lastMonth = [int]$Matches[1] } }
    $now = Get-Date
    $from = if ($lastMonth) { $lastMonth } else { [int]$now.AddMonths(-1).ToString('yyyyMM') }
    $anyDcim = $false
    $empty = $true
    foreach ($st in $storages) {
        $top = @($st.GetFolder.Items())
        if ($top.Count) { $empty = $false }
        $dcim = Child $st 'DCIM'
        if ($dcim) { $anyDcim = $true; Walk $dcim 0 }
        $pics = Child $st 'Pictures'
        if ($pics) { $ss = Child $pics 'Screenshots'; if ($ss) { Walk $ss 0 } }
        # an iPhone often shows its photo folders right at the top: "202611_a", "100APPLE"...
        foreach ($x in $top) {
            if (-not $x.IsFolder) { continue }
            if ($x.Name -match '^(\d{6})_[a-z]$') { $anyDcim = $true; if ([int]$Matches[1] -ge $from) { Walk $x 1 } }
            elseif ($x.Name -match '^\d{3}(APPLE|_PANO|CLOUD)$') { $anyDcim = $true; Walk $x 1 }
        }
    }
    # nothing visible at all: the phone keeps its photos closed (iPhone locked or not trusted, Android not in file mode)
    if ($empty) { Say @{ error = 'locked' }; exit 1 }
    if (-not $anyDcim) { Say @{ error = 'nodcim' }; exit 1 }
    if ($Known -and -not $DryRun) { [IO.File]::AppendAllText($Known, "#last:" + $now.ToString('yyyyMM') + "`r`n") }
    $new = @($found | Where-Object { -not $seen.ContainsKey("$($_.Name)|$(Size $_)") })
    [int64]$bytes = 0; foreach ($x in $new) { $bytes += (Size $x) }
    Say @{ total = $new.Count; bytes = $bytes; all = $found.Count; from = $from }
    if ($DryRun) { exit 0 } # only counting
    if (-not $new.Count) { Say @{ done = 0 }; exit 0 }
    [void](New-Item -ItemType Directory -Force -Path $Dest)
    $target = $sh.Namespace($Dest)
    $k = 0
    foreach ($x in $new) {
        $k++
        $sz = Size $x
        $base = [IO.Path]::GetFileNameWithoutExtension($x.Name)
        $have = Get-ChildItem -LiteralPath $Dest -File -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -ieq $base } | Select-Object -First 1
        if ($have) { [IO.File]::AppendAllText($Known, "$($x.Name)|$sz`r`n"); Say @{ file = $x.Name; size = $have.Length; i = $k; skip = $true }; continue }
        $target.CopyHere($x, 4 + 16 + 512 + 1024)
        $got = WaitFile $Dest $x.Name ([int](30 + $sz / 2MB))
        if ($got) { [IO.File]::AppendAllText($Known, "$($x.Name)|$sz`r`n"); Say @{ file = $x.Name; size = $got.Length; i = $k } }
        else { Say @{ file = $x.Name; size = 0; i = $k; failed = $true } }
    }
    Say @{ done = $k }
    exit 0
}

if ($Mode -eq 'send') {
    $paths = @([IO.File]::ReadAllLines($List) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
    $st = $storages[0]
    $dl = Child $st 'Download'
    if (-not $dl) { $dl = Child $st 'Downloads' }
    if (-not $dl) { $dl = $st }
    [int64]$bytes = 0; foreach ($p in $paths) { $bytes += (Get-Item -LiteralPath $p).Length }
    Say @{ total = $paths.Count; bytes = $bytes; to = $dl.Name }
    $k = 0
    foreach ($p in $paths) {
        $k++
        $name = [IO.Path]::GetFileName($p)
        $size = (Get-Item -LiteralPath $p).Length
        $dl.GetFolder.CopyHere($p, 4 + 16 + 512 + 1024)
        # the phone's folder has no file path to watch: wait until the item shows up there
        $t0 = Get-Date; $ok = $false
        while (((Get-Date) - $t0).TotalSeconds -lt (30 + $size / 2MB)) {
            $it = $dl.GetFolder.ParseName($name)
            if ($it -and ((Size $it) -ge $size -or $size -eq 0)) { $ok = $true; break }
            Start-Sleep -Milliseconds 300
        }
        Say @{ file = $name; size = $size; i = $k; failed = (-not $ok) }
    }
    Say @{ done = $k }
    exit 0
}
Say @{ error = 'mode' }
