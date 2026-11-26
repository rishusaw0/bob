param(
  [string]$Task = "cpu-telemetry",
  [string]$Arg1 = "",
  [string]$Arg2 = "",
  [string]$Arg3 = "",
  [int]$Num1 = 0,
  [int]$Num2 = 0,
  [int]$Num3 = 0,
  [int]$Num4 = 0
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Ensure-WinInputType {
  if (-not ("JeevaWinInput" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class JeevaWinInput {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public class MEMORYSTATUSEX {
    public uint dwLength;
    public uint dwMemoryLoad;
    public ulong ullTotalPhys;
    public ulong ullAvailPhys;
    public ulong ullTotalPageFile;
    public ulong ullAvailPageFile;
    public ulong ullTotalVirtual;
    public ulong ullAvailVirtual;
    public ulong ullAvailExtendedVirtual;
    public MEMORYSTATUSEX() {
      this.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
    }
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_WHEEL = 0x0800;
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@
  }
  [JeevaWinInput]::SetProcessDPIAware() | Out-Null
}

function Resolve-UserFolderShortcut {
  param([string]$InputPath)
  $trimmed = ($InputPath -as [string]).Trim()
  if (-not $trimmed) { return "" }
  switch ($trimmed.ToLower()) {
    "downloads" { return (Join-Path $env:USERPROFILE "Downloads") }
    "desktop"   { return ([Environment]::GetFolderPath("Desktop")) }
    "documents" { return ([Environment]::GetFolderPath("MyDocuments")) }
    "pictures"  { return ([Environment]::GetFolderPath("MyPictures")) }
    "music"     { return ([Environment]::GetFolderPath("MyMusic")) }
    "videos"    { return ([Environment]::GetFolderPath("MyVideos")) }
    "home"      { return $env:USERPROFILE }
    default     { return [Environment]::ExpandEnvironmentVariables($trimmed) }
  }
}

function Get-VirtualKeyCode {
  param([string]$KeyName)
  $k = $KeyName.Trim().ToLower()
  $map = @{
    "ctrl" = 0x11; "control" = 0x11; "lctrl" = 0xA2;
    "alt" = 0x12; "menu" = 0x12; "lalt" = 0xA4;
    "shift" = 0x10; "lshift" = 0xA0;
    "win" = 0x5B; "windows" = 0x5B; "lwin" = 0x5B; "meta" = 0x5B;
    "enter" = 0x0D; "return" = 0x0D;
    "tab" = 0x09;
    "esc" = 0x1B; "escape" = 0x1B;
    "space" = 0x20;
    "backspace" = 0x08; "back" = 0x08;
    "del" = 0x2E; "delete" = 0x2E;
    "insert" = 0x2D;
    "home" = 0x24; "end" = 0x23;
    "pageup" = 0x21; "pgup" = 0x21;
    "pagedown" = 0x22; "pgdn" = 0x22;
    "left" = 0x25; "up" = 0x26; "right" = 0x27; "down" = 0x28;
    "printscreen" = 0x2C; "prtsc" = 0x2C;
    "capslock" = 0x14;
    "f1" = 0x70; "f2" = 0x71; "f3" = 0x72; "f4" = 0x73;
    "f5" = 0x74; "f6" = 0x75; "f7" = 0x76; "f8" = 0x77;
    "f9" = 0x78; "f10" = 0x79; "f11" = 0x7A; "f12" = 0x7B;
    "playpause" = 0xB3; "nexttrack" = 0xB0; "prevtrack" = 0xB1;
    "volmute" = 0xAD; "voldown" = 0xAE; "volup" = 0xAF;
    "plus" = 0xBB; "=" = 0xBB; "-" = 0xBD; "minus" = 0xBD;
    "," = 0xBC; "." = 0xBE; "/" = 0xBF; ";" = 0xBA
  }
  if ($map.ContainsKey($k)) { return [byte]$map[$k] }
  if ($k.Length -eq 1) {
    $ch = [char]::ToUpper($k[0])
    $code = [int]$ch
    if (($code -ge 65 -and $code -le 90) -or ($code -ge 48 -and $code -le 57)) {
      return [byte]$code
    }
  }
  return $null
}

function Get-FixedDisks {
  return @([System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object {
    $totalGb = [math]::Round($_.TotalSize / 1GB, 1)
    $freeGb = [math]::Round($_.AvailableFreeSpace / 1GB, 1)
    $usedPct = if ($_.TotalSize -gt 0) { [math]::Round((($_.TotalSize - $_.AvailableFreeSpace) / $_.TotalSize) * 100) } else { 0 }
    [PSCustomObject]@{
      drive = $_.Name.TrimEnd('\')
      label = $_.VolumeLabel
      fileSystem = $_.DriveFormat
      totalGb = $totalGb
      freeGb = $freeGb
      usedPct = $usedPct
    }
  })
}

switch ($Task) {
  "cpu-telemetry" {
    Ensure-WinInputType
    $mem = New-Object JeevaWinInput+MEMORYSTATUSEX
    [JeevaWinInput]::GlobalMemoryStatusEx($mem) | Out-Null

    $ramTotalGb = [math]::Round($mem.ullTotalPhys / 1GB, 1)
    $ramFreeGb = [math]::Round($mem.ullAvailPhys / 1GB, 1)
    $ramUsedPct = [int]$mem.dwMemoryLoad
    $cpuName = (Get-ItemProperty "HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0" -ErrorAction SilentlyContinue).ProcessorNameString
    if ($cpuName) { $cpuName = $cpuName.Trim() } else { $cpuName = "Windows Processor" }

    $osCaption = [System.Environment]::OSVersion.VersionString
    $buildNum = ""
    $uptimeHours = [math]::Round([Environment]::TickCount / 3600000.0, 1)
    $cpuCores = $null
    $cpuLogical = [Environment]::ProcessorCount
    $cpuLoadPct = $null
    $gpus = @()

    try {
      $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
      $osCaption = "$($os.Caption) ($($os.OSArchitecture))"
      $buildNum = $os.BuildNumber
      $uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    } catch {}

    try {
      $cpu = Get-CimInstance Win32_Processor -ErrorAction Stop | Select-Object -First 1
      if ($cpu.Name) { $cpuName = $cpu.Name.Trim() }
      $cpuCores = $cpu.NumberOfCores
      $cpuLogical = $cpu.NumberOfLogicalProcessors
      if ($null -ne $cpu.LoadPercentage) { $cpuLoadPct = [int]$cpu.LoadPercentage }
    } catch {}

    try {
      $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object {
        [PSCustomObject]@{
          name = $_.Name
          driverVersion = $_.DriverVersion
          vramMb = if ($_.AdapterRAM) { [math]::Round($_.AdapterRAM / 1MB) } else { $null }
        }
      })
    } catch {}

    $result = [PSCustomObject]@{
      hostname = $env:COMPUTERNAME
      user = $env:USERNAME
      os = $osCaption
      build = $buildNum
      uptimeHours = $uptimeHours
      cpuName = $cpuName
      cpuCores = $cpuCores
      cpuLogical = $cpuLogical
      cpuLoadPct = $cpuLoadPct
      ramTotalGb = $ramTotalGb
      ramFreeGb = $ramFreeGb
      ramUsedPct = $ramUsedPct
      gpus = $gpus
      disks = (Get-FixedDisks)
    }
    Write-Output ($result | ConvertTo-Json -Depth 4 -Compress)
  }

  "top-processes" {
    $limit = if ($Num1 -gt 0 -and $Num1 -le 40) { $Num1 } else { 15 }
    $sortBy = if ($Arg1 -eq "cpu") { "CPU" } else { "WorkingSet64" }
    $procs = Get-Process | Sort-Object $sortBy -Descending | Select-Object -First $limit | ForEach-Object {
      [PSCustomObject]@{
        id = $_.Id
        name = $_.ProcessName
        ramMb = [math]::Round($_.WorkingSet64 / 1MB, 1)
        cpuSec = if ($null -ne $_.CPU) { [math]::Round($_.CPU, 1) } else { 0 }
        title = [string]$_.MainWindowTitle
      }
    }
    Write-Output (@($procs) | ConvertTo-Json -Depth 3 -Compress)
  }

  "kill-process" {
    $target = $Arg1.Trim()
    if (-not $target) {
      Write-Error "Target PID or process name is required."
      exit 1
    }
    $protectedNames = @("system", "idle", "csrss", "wininit", "lsass", "smss", "services", "winlogon", "registry")
    if ($target -match '^\d+$') {
      $procId = [int]$target
      if ($procId -le 4) {
        Write-Error "Refusing to terminate protected kernel PID $procId."
        exit 1
      }
      $p = Get-Process -Id $procId -ErrorAction Stop
      if ($protectedNames -contains $p.ProcessName.ToLower()) {
        Write-Error "Refusing to terminate protected Windows process: $($p.ProcessName)"
        exit 1
      }
      Stop-Process -Id $procId -Force
      Write-Output (@{ success = $true; killed = $p.ProcessName; pid = $procId } | ConvertTo-Json -Compress)
    } else {
      $cleanName = $target -replace '\.exe$', ''
      if ($protectedNames -contains $cleanName.ToLower()) {
        Write-Error "Refusing to terminate protected Windows process: $cleanName"
        exit 1
      }
      $foundProcs = @(Get-Process -Name $cleanName -ErrorAction Stop)
      Stop-Process -Name $cleanName -Force
      Write-Output (@{ success = $true; killed = $cleanName; count = $foundProcs.Count } | ConvertTo-Json -Compress)
    }
  }

  "disk-space" {
    Write-Output ((Get-FixedDisks) | ConvertTo-Json -Depth 3 -Compress)
  }

  "network-ports" {
    $procLookup = @{}
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $procLookup[$_.Id] = $_.ProcessName }
    $ports = @()
    try {
      $ports = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Sort-Object LocalPort |
        Select-Object -First 35 |
        ForEach-Object {
          [PSCustomObject]@{
            port = $_.LocalPort
            address = $_.LocalAddress
            pid = $_.OwningProcess
            process = if ($procLookup.ContainsKey($_.OwningProcess)) { $procLookup[$_.OwningProcess] } else { "PID:$($_.OwningProcess)" }
          }
        })
    } catch {
      $seen = @{}
      $netLines = (& netstat -ano -p TCP) 2>$null
      foreach ($line in $netLines) {
        if ($line -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
          $addr = $Matches[1]
          $port = [int]$Matches[2]
          $owningPid = [int]$Matches[3]
          $k = "$addr`:$port"
          if (-not $seen.ContainsKey($k)) {
            $seen[$k] = $true
            $ports += [PSCustomObject]@{
              port = $port
              address = $addr
              pid = $owningPid
              process = if ($procLookup.ContainsKey($owningPid)) { $procLookup[$owningPid] } else { "PID:$owningPid" }
            }
          }
        }
      }
      $ports = @($ports | Sort-Object port | Select-Object -First 35)
    }
    Write-Output ($ports | ConvertTo-Json -Depth 3 -Compress)
  }

  "display-info" {
    Ensure-WinInputType
    Add-Type -AssemblyName System.Windows.Forms
    $pt = New-Object JeevaWinInput+POINT
    [JeevaWinInput]::GetCursorPos([ref]$pt) | Out-Null

    $hwnd = [JeevaWinInput]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 256
    [JeevaWinInput]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null

    $screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
      [PSCustomObject]@{
        device = $_.DeviceName
        primary = $_.Primary
        width = $_.Bounds.Width
        height = $_.Bounds.Height
        x = $_.Bounds.X
        y = $_.Bounds.Y
      }
    })

    $out = [PSCustomObject]@{
      cursor = @{ x = $pt.X; y = $pt.Y }
      foregroundWindow = $sb.ToString()
      screens = $screens
    }
    Write-Output ($out | ConvertTo-Json -Depth 4 -Compress)
  }

  "mouse-action" {
    Ensure-WinInputType
    $sub = $Arg1.Trim().ToLower()
    switch ($sub) {
      "move" {
        [JeevaWinInput]::SetCursorPos($Num1, $Num2) | Out-Null
        Write-Output "Mouse moved to ($Num1, $Num2)"
      }
      "click" {
        if ($Num1 -ge 0 -and $Num2 -ge 0) {
          [JeevaWinInput]::SetCursorPos($Num1, $Num2) | Out-Null
          Start-Sleep -Milliseconds 40
        }
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 25
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        Write-Output "Left click at ($Num1, $Num2)"
      }
      "double_click" {
        if ($Num1 -ge 0 -and $Num2 -ge 0) {
          [JeevaWinInput]::SetCursorPos($Num1, $Num2) | Out-Null
          Start-Sleep -Milliseconds 40
        }
        for ($i = 0; $i -lt 2; $i++) {
          [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 20
          [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 55
        }
        Write-Output "Double click at ($Num1, $Num2)"
      }
      "right_click" {
        if ($Num1 -ge 0 -and $Num2 -ge 0) {
          [JeevaWinInput]::SetCursorPos($Num1, $Num2) | Out-Null
          Start-Sleep -Milliseconds 40
        }
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 25
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
        Write-Output "Right click at ($Num1, $Num2)"
      }
      "scroll" {
        if ($Num2 -gt 0 -and $Num3 -gt 0) {
          [JeevaWinInput]::SetCursorPos($Num2, $Num3) | Out-Null
          Start-Sleep -Milliseconds 30
        }
        $notches = if ($Num1 -ne 0) { $Num1 } else { -3 }
        $wheelDelta = $notches * 120
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_WHEEL, 0, 0, $wheelDelta, [UIntPtr]::Zero)
        Write-Output "Scrolled wheel by $notches notches"
      }
      "drag" {
        [JeevaWinInput]::SetCursorPos($Num1, $Num2) | Out-Null
        Start-Sleep -Milliseconds 45
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 45
        $steps = 12
        for ($s = 1; $s -le $steps; $s++) {
          $ix = [int]($Num1 + (($Num3 - $Num1) * $s / $steps))
          $iy = [int]($Num2 + (($Num4 - $Num2) * $s / $steps))
          [JeevaWinInput]::SetCursorPos($ix, $iy) | Out-Null
          Start-Sleep -Milliseconds 15
        }
        [JeevaWinInput]::mouse_event([JeevaWinInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        Write-Output "Dragged from ($Num1, $Num2) to ($Num3, $Num4)"
      }
      default {
        Write-Error "Unknown mouse-action subcommand: $sub"
        exit 1
      }
    }
  }

  "hotkey-combo" {
    Ensure-WinInputType
    $combo = $Arg1.Trim()
    if (-not $combo) {
      Write-Error "Hotkey string is required (e.g. ctrl+shift+t, win+d)"
      exit 1
    }
    $parts = @($combo -split '\+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $vkList = @()
    foreach ($part in $parts) {
      $vk = Get-VirtualKeyCode $part
      if ($null -eq $vk) {
        Write-Error "Unsupported key in hotkey combo: $part"
        exit 1
      }
      $vkList += $vk
    }
    foreach ($vk in $vkList) {
      [JeevaWinInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 15
    }
    Start-Sleep -Milliseconds 45
    for ($i = $vkList.Count - 1; $i -ge 0; $i--) {
      [JeevaWinInput]::keybd_event($vkList[$i], 0, [JeevaWinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 15
    }
    Write-Output "Sent hotkey: $combo"
  }

  "clipboard-paste-text" {
    Ensure-WinInputType
    Add-Type -AssemblyName System.Windows.Forms
    $decoded = if ($Arg2 -eq "base64" -and $Arg1) {
      [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Arg1))
    } else {
      $Arg1
    }
    if (-not $decoded) {
      Write-Error "No text provided to paste."
      exit 1
    }
    [System.Windows.Forms.Clipboard]::SetText($decoded)
    Start-Sleep -Milliseconds 50
    [JeevaWinInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero) # Ctrl down
    Start-Sleep -Milliseconds 15
    [JeevaWinInput]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero) # V down
    Start-Sleep -Milliseconds 35
    [JeevaWinInput]::keybd_event(0x56, 0, [JeevaWinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [JeevaWinInput]::keybd_event(0x11, 0, [JeevaWinInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Write-Output "Pasted $($decoded.Length) characters into active window"
  }

  "file-pro" {
    $sub = $Arg1.Trim().ToLower()
    $src = Resolve-UserFolderShortcut $Arg2
    $dst = Resolve-UserFolderShortcut $Arg3
    foreach ($p in @($src, $dst)) {
      if ($p -and ($p -imatch '^[a-z]:\\windows(\\|$)|\\\.env(\.[a-z0-9_-]+)?$|\\google\\chrome\\user data|\\microsoft\\edge\\user data|\.vault$')) {
        Write-Error "Blocked by PowerShell Security Guardrails: protected path $p"
        exit 1
      }
    }

    switch ($sub) {
      "mkdir" {
        if (-not $src) { Write-Error "Target directory path is required."; exit 1 }
        $item = New-Item -ItemType Directory -Path $src -Force
        Write-Output (@{ success = $true; path = $item.FullName } | ConvertTo-Json -Compress)
      }
      "move" {
        if (-not (Test-Path -LiteralPath $src)) { Write-Error "Source path does not exist: $src"; exit 1 }
        if (-not $dst) { Write-Error "Destination path is required."; exit 1 }
        $dstParent = Split-Path -Path $dst -Parent
        if ($dstParent -and -not (Test-Path -LiteralPath $dstParent)) {
          New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
        }
        $moved = Move-Item -LiteralPath $src -Destination $dst -PassThru -ErrorAction Stop
        Write-Output (@{ success = $true; from = $src; to = $moved.FullName } | ConvertTo-Json -Compress)
      }
      "rename" {
        if (-not (Test-Path -LiteralPath $src)) { Write-Error "Source path does not exist: $src"; exit 1 }
        if (-not $Arg3.Trim()) { Write-Error "New name is required."; exit 1 }
        $leafName = Split-Path -Path $Arg3.Trim() -Leaf
        $renamed = Rename-Item -LiteralPath $src -NewName $leafName -PassThru -ErrorAction Stop
        Write-Output (@{ success = $true; from = $src; to = $renamed.FullName } | ConvertTo-Json -Compress)
      }
      "zip" {
        if (-not (Test-Path -LiteralPath $src)) { Write-Error "Source path does not exist: $src"; exit 1 }
        $archiveDest = if ($dst) { $dst } else { "$src.zip" }
        Compress-Archive -LiteralPath $src -DestinationPath $archiveDest -Force
        Write-Output (@{ success = $true; archive = $archiveDest } | ConvertTo-Json -Compress)
      }
      "unzip" {
        if (-not (Test-Path -LiteralPath $src)) { Write-Error "Archive does not exist: $src"; exit 1 }
        $extractDir = if ($dst) { $dst } else { Join-Path (Split-Path -Path $src -Parent) ([System.IO.Path]::GetFileNameWithoutExtension($src)) }
        Expand-Archive -LiteralPath $src -DestinationPath $extractDir -Force
        Write-Output (@{ success = $true; extractedTo = $extractDir } | ConvertTo-Json -Compress)
      }
      "organize_folder" {
        $folder = if ($src) { $src } else { Resolve-UserFolderShortcut "downloads" }
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
          Write-Error "Folder not found: $folder"
          exit 1
        }
        $rules = @{
          "Images"     = @(".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".ico", ".heic")
          "Documents"  = @(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".csv", ".rtf")
          "Videos"     = @(".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".m4v")
          "Audio"      = @(".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac")
          "Archives"   = @(".zip", ".rar", ".7z", ".tar", ".gz")
          "Installers" = @(".exe", ".msi", ".msix", ".bat", ".ps1")
          "Code"       = @(".js", ".ts", ".jsx", ".tsx", ".py", ".html", ".css", ".json", ".xml", ".sql", ".c", ".cpp", ".java")
        }
        $skipExts = @(".ini", ".lnk", ".tmp", ".crdownload", ".part", ".partial")
        $counts = @{}
        $movedTotal = 0
        $skipped = 0

        Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue | ForEach-Object {
          $ext = $_.Extension.ToLower()
          if ($skipExts -contains $ext -or $_.Attributes -match "Hidden|System") {
            $skipped++
            return
          }
          $bucket = "Other"
          foreach ($cat in $rules.Keys) {
            if ($rules[$cat] -contains $ext) {
              $bucket = $cat
              break
            }
          }
          $targetDir = Join-Path $folder $bucket
          if (-not (Test-Path -LiteralPath $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
          }
          $destFile = Join-Path $targetDir $_.Name
          if (Test-Path -LiteralPath $destFile) {
            $base = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
            $counter = 1
            do {
              $destFile = Join-Path $targetDir "$base`_$counter$ext"
              $counter++
            } while (Test-Path -LiteralPath $destFile)
          }
          try {
            Move-Item -LiteralPath $_.FullName -Destination $destFile -ErrorAction Stop
            $movedTotal++
            if (-not $counts.ContainsKey($bucket)) { $counts[$bucket] = 0 }
            $counts[$bucket]++
          } catch {
            $skipped++
          }
        }
        Write-Output (@{
          success = $true
          folder = $folder
          movedTotal = $movedTotal
          skipped = $skipped
          categories = $counts
        } | ConvertTo-Json -Depth 3 -Compress)
      }
      default {
        Write-Error "Unknown file-pro action: $sub"
        exit 1
      }
    }
  }

  "power-plan" {
    $sub = ($Arg1 -as [string]).Trim().ToLower()
    $guids = @{
      "balanced"         = "381b4222-f694-41f0-9685-ff5bb260df2e"
      "high_performance" = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
      "power_saver"      = "a1841308-3541-4fab-bc81-f71556f20b4a"
    }
    if (-not $sub -or $sub -eq "get") {
      $active = (& powercfg /getactivescheme) | Out-String
      Write-Output $active.Trim()
      return
    }
    if (-not $guids.ContainsKey($sub)) {
      Write-Error "Unknown power plan: $sub. Use balanced, high_performance, or power_saver."
      exit 1
    }
    $targetGuid = $guids[$sub]
    $listOut = (& powercfg /list) | Out-String
    if (-not ($listOut -match $targetGuid)) {
      # Attempt to duplicate scheme cleanly on Modern Standby systems where it isn't listed yet
      & powercfg /duplicatescheme $targetGuid 2>$null | Out-Null
    }
    & powercfg /setactive $targetGuid | Out-Null
    if ($LASTEXITCODE -ne 0) {
      # Fallback: match name case-insensitively in powercfg /list
      $friendly = ($sub -replace '_', ' ')
      $matchedLine = ($listOut -split "`n") | Where-Object { $_ -imatch $friendly } | Select-Object -First 1
      if ($matchedLine -match '([0-9a-fA-F]{8}-[0-9a-fA-F-]{27})') {
        & powercfg /setactive $Matches[1] | Out-Null
      } else {
        Write-Error "Power plan '$sub' is not supported by this Windows hardware (Modern Standby may restrict schemes)."
        exit 1
      }
    }
    $nowActive = (& powercfg /getactivescheme) | Out-String
    Write-Output $nowActive.Trim()
  }

  "empty-recycle-bin" {
    Clear-RecycleBin -Force -ErrorAction Stop
    Write-Output "Recycle Bin emptied cleanly."
  }

  default {
    Write-Error "Unknown task in win-power.ps1: $Task"
    exit 1
  }
}
