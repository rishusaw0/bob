param(
  [string]$Task = "active_tab_info",
  [string]$Arg1 = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class JeevaBrowserWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

function Find-BrowserWindow {
  $names = @("chrome", "msedge", "brave", "firefox", "opera")
  foreach ($n in $names) {
    $proc = Get-Process -Name $n -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle } |
      Select-Object -First 1
    if ($proc) { return $proc }
  }
  return $null
}

function Send-Combo([byte[]]$vks) {
  foreach ($vk in $vks) {
    [JeevaBrowserWin]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 12
  }
  Start-Sleep -Milliseconds 40
  for ($i = $vks.Count - 1; $i -ge 0; $i--) {
    [JeevaBrowserWin]::keybd_event($vks[$i], 0, [JeevaBrowserWin]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 12
  }
}

if ($Task -eq "launch_debug") {
  $debugProfile = Join-Path $env:TEMP "jeeva-chrome-debug"
  if (-not (Test-Path $debugProfile)) { New-Item -ItemType Directory -Path $debugProfile -Force | Out-Null }
  $launched = $false
  foreach ($exe in @("chrome.exe", "msedge.exe")) {
    try {
      Start-Process $exe -ArgumentList "--remote-debugging-port=9222", "--user-data-dir=`"$debugProfile`"" -ErrorAction Stop
      $launched = $true
      Write-Output "Launched $exe with CDP debugging port 9222"
      break
    } catch {}
  }
  if (-not $launched) {
    Write-Error "Could not find Chrome or Edge to launch debug session."
    exit 1
  }
  exit 0
}

$browser = Find-BrowserWindow
if (-not $browser) {
  Write-Error "No open browser window found (Chrome, Edge, Brave, Firefox)."
  exit 1
}

[JeevaBrowserWin]::ShowWindow($browser.MainWindowHandle, 9) | Out-Null
[JeevaBrowserWin]::SetForegroundWindow($browser.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 90

switch ($Task) {
  "active_tab_info" {
    $urlVal = ""
    try {
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $win = [System.Windows.Automation.AutomationElement]::FromHandle($browser.MainWindowHandle)
      $editCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Edit
      )
      $edits = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
      foreach ($ed in $edits) {
        $vp = $null
        if ($ed.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
          $candidate = [string]$vp.Current.Value
          if ($candidate -match '^(https?://|[a-z0-9.-]+\.[a-z]{2,})') {
            $urlVal = $candidate
            break
          }
        }
      }
    } catch {}
    Write-Output (@{
      browser = $browser.ProcessName
      title = $browser.MainWindowTitle
      url = $urlVal
    } | ConvertTo-Json -Compress)
  }
  "new_tab"            { Send-Combo @(0x11, 0x54); Write-Output "Opened new tab in $($browser.ProcessName)" }
  "new_incognito"      { Send-Combo @(0x11, 0x10, 0x4E); Write-Output "Opened Incognito/Private window in $($browser.ProcessName)" }
  "close_tab"          { Send-Combo @(0x11, 0x57); Write-Output "Closed active tab in $($browser.ProcessName)" }
  "reopen_tab"         { Send-Combo @(0x11, 0x10, 0x54); Write-Output "Reopened last closed tab" }
  "next_tab"           { Send-Combo @(0x11, 0x09); Write-Output "Switched to next tab" }
  "prev_tab"           { Send-Combo @(0x11, 0x10, 0x09); Write-Output "Switched to previous tab" }
  "downloads"          { Send-Combo @(0x11, 0x4A); Write-Output "Opened browser Downloads" }
  "history"            { Send-Combo @(0x11, 0x48); Write-Output "Opened browser History" }
  "bookmarks"          { Send-Combo @(0x11, 0x10, 0x4F); Write-Output "Opened Bookmark Manager" }
  "zoom_in"            { Send-Combo @(0x11, 0xBB); Write-Output "Zoomed in browser page" }
  "zoom_out"           { Send-Combo @(0x11, 0xBD); Write-Output "Zoomed out browser page" }
  "zoom_reset"         { Send-Combo @(0x11, 0x30); Write-Output "Reset browser zoom to 100%" }
  "back"               { Send-Combo @(0x12, 0x25); Write-Output "Navigated Back" }
  "forward"            { Send-Combo @(0x12, 0x27); Write-Output "Navigated Forward" }
  "refresh"            { Send-Combo @(0x74); Write-Output "Refreshed active tab" }
  "youtube_play_pause" { Send-Combo @(0x4B); Write-Output "Toggled YouTube playback (K)" }
  "youtube_next"       { Send-Combo @(0x10, 0x4E); Write-Output "Skipped to next video (Shift+N)" }
  "youtube_prev"       { Send-Combo @(0x10, 0x50); Write-Output "Switched to previous video (Shift+P)" }
  "youtube_mute"       { Send-Combo @(0x4D); Write-Output "Toggled YouTube mute (M)" }
  "youtube_fullscreen" { Send-Combo @(0x46); Write-Output "Toggled YouTube fullscreen (F)" }
  "youtube_theater"    { Send-Combo @(0x54); Write-Output "Toggled YouTube theater mode (T)" }
  "youtube_captions"   { Send-Combo @(0x43); Write-Output "Toggled YouTube subtitles/captions (C)" }
  "youtube_forward"    { Send-Combo @(0x4C); Write-Output "Forwarded YouTube 10 seconds (L)" }
  "youtube_rewind"     { Send-Combo @(0x4A); Write-Output "Rewound YouTube 10 seconds (J)" }
  "youtube_speed_up"   { Send-Combo @(0x10, 0xBE); Write-Output "Increased YouTube playback speed" }
  "youtube_speed_down" { Send-Combo @(0x10, 0xBC); Write-Output "Decreased YouTube playback speed" }
  "find_on_page" {
    if ($Arg1) {
      [System.Windows.Forms.Clipboard]::SetText($Arg1)
      Send-Combo @(0x11, 0x46)
      Start-Sleep -Milliseconds 80
      Send-Combo @(0x11, 0x56)
      Start-Sleep -Milliseconds 40
      Send-Combo @(0x0D)
      Write-Output "Searched page for: $Arg1"
    } else {
      Send-Combo @(0x11, 0x46)
      Write-Output "Opened Find bar"
    }
  }
  default {
    Write-Error "Unknown browser action: $Task"
    exit 1
  }
}
