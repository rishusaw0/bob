param(
  [string]$Task = "list-installed",
  [string]$Arg1 = "",
  [string]$Arg2 = "",
  [string]$Arg3 = ""
)

$ErrorActionPreference = "Stop"

switch ($Task) {
  "list-installed" {
    $filter = $Arg1.Trim().ToLower()
    $apps = @{}

    $regPaths = @(
      "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
      "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
      "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($rp in $regPaths) {
      Get-ItemProperty $rp -ErrorAction SilentlyContinue | ForEach-Object {
        $name = [string]$_.DisplayName
        if ($name -and (-not $filter -or $name.ToLower().Contains($filter))) {
          $key = $name.ToLower().Trim()
          if (-not $apps.ContainsKey($key)) {
            $apps[$key] = [PSCustomObject]@{
              name = $name.Trim()
              version = [string]$_.DisplayVersion
              publisher = [string]$_.Publisher
              source = "Registry"
            }
          }
        }
      }
    }

    try {
      Get-StartApps | ForEach-Object {
        $name = [string]$_.Name
        if ($name -and (-not $filter -or $name.ToLower().Contains($filter))) {
          $key = $name.ToLower().Trim()
          if (-not $apps.ContainsKey($key)) {
            $apps[$key] = [PSCustomObject]@{
              name = $name.Trim()
              version = ""
              publisher = "Start Menu"
              source = "StartApps"
            }
          }
        }
      }
    } catch {}

    $list = @($apps.Values | Sort-Object name | Select-Object -First 150)
    if ($list.Count -eq 0) {
      Write-Output "[]"
    } else {
      Write-Output (ConvertTo-Json -InputObject $list -Compress)
    }
  }

  "winget-search" {
    if (-not $Arg1.Trim()) { Write-Error "Package query required"; exit 1 }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not available on this Windows system."
      exit 1
    }
    $out = winget search $Arg1.Trim() --accept-source-agreements 2>&1
    ($out -join "`n")
  }

  "winget-install" {
    $pkg = $Arg1.Trim()
    if (-not $pkg) { Write-Error "Package name or ID required"; exit 1 }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not installed on this Windows system."
      exit 1
    }
    $out = winget install $pkg --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
    $exit = $LASTEXITCODE
    $text = ($out -join "`n").Trim()
    if ($exit -ne 0) {
      Write-Error "winget install failed ($exit): $text"
      exit 1
    }
    if ($text) { Write-Output $text } else { Write-Output "Installed $pkg successfully" }
  }

  "winget-uninstall" {
    $pkg = $Arg1.Trim()
    if (-not $pkg) { Write-Error "Package name or ID required"; exit 1 }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not installed on this Windows system."
      exit 1
    }
    $out = winget uninstall $pkg --accept-source-agreements --disable-interactivity 2>&1
    $exit = $LASTEXITCODE
    $text = ($out -join "`n").Trim()
    if ($exit -ne 0) {
      Write-Error "winget uninstall failed ($exit): $text"
      exit 1
    }
    if ($text) { Write-Output $text } else { Write-Output "Uninstalled $pkg successfully" }
  }

  "winget-update" {
    $pkg = $Arg1.Trim()
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      Write-Error "winget is not installed on this Windows system."
      exit 1
    }
    if (-not $pkg -or $pkg.ToLower() -eq "all") {
      $out = winget upgrade --accept-package-agreements --accept-source-agreements 2>&1
    } else {
      $out = winget upgrade $pkg --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1
    }
    ($out -join "`n").Trim()
  }

  "window-control" {
    $action = $Arg1.Trim().ToLower()
    $target = $Arg2.Trim().ToLower()
    if (-not $target) { Write-Error "Target app/window name required"; exit 1 }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@

    $procs = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    }

    $proc = $procs | Select-Object -First 1
    if (-not $proc) {
      Write-Error "No open window found matching '$Arg2'"
      exit 1
    }

    $hWnd = $proc.MainWindowHandle
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

    switch ($action) {
      "focus" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Focused window: $($proc.MainWindowTitle)"
      }
      "maximize" {
        [WinAPI]::ShowWindow($hWnd, 3) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Maximized window: $($proc.MainWindowTitle)"
      }
      "minimize" {
        [WinAPI]::ShowWindow($hWnd, 6) | Out-Null
        Write-Output "Minimized window: $($proc.MainWindowTitle)"
      }
      "restore" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Restored window: $($proc.MainWindowTitle)"
      }
      "snap_left" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::MoveWindow($hWnd, $wa.X, $wa.Y, [int]($wa.Width / 2), $wa.Height, $true) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Snapped left: $($proc.MainWindowTitle)"
      }
      "snap_right" {
        [WinAPI]::ShowWindow($hWnd, 9) | Out-Null
        [WinAPI]::MoveWindow($hWnd, $wa.X + [int]($wa.Width / 2), $wa.Y, [int]($wa.Width / 2), $wa.Height, $true) | Out-Null
        [WinAPI]::SetForegroundWindow($hWnd) | Out-Null
        Write-Output "Snapped right: $($proc.MainWindowTitle)"
      }
      "close" {
        [WinAPI]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        Write-Output "Sent close request to: $($proc.MainWindowTitle)"
      }
      default {
        Write-Error "Unknown window action: $action"
        exit 1
      }
    }
  }

  "ui-inspect" {
    $target = $Arg1.Trim().ToLower()
    if (-not $target) { Write-Error "App/window name required"; exit 1 }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $proc = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    } | Select-Object -First 1

    if (-not $proc) { Write-Error "Open window not found for '$Arg1'"; exit 1 }

    $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $cond = [System.Windows.Automation.Condition]::TrueCondition
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)

    $interesting = @("Button", "MenuItem", "TabItem", "Edit", "CheckBox", "RadioButton", "ComboBox", "Hyperlink", "ListItem")
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($el in $all) {
      $ct = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
      $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
      if ($nm -and ($interesting -contains $ct)) {
        $items.Add("$ct : $nm")
        if ($items.Count -ge 65) { break }
      }
    }
    if ($items.Count -eq 0) {
      Write-Output "Window '$($proc.MainWindowTitle)' found, no named UIA controls exposed."
    } else {
      Write-Output ("Window: $($proc.MainWindowTitle)`n" + ($items -join "`n"))
    }
  }

  "ui-click" {
    $target = $Arg1.Trim().ToLower()
    $elemQuery = $Arg2.Trim().ToLower()
    if (-not $target -or -not $elemQuery) { Write-Error "App name and element name required"; exit 1 }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseHelper {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint cButtons, uint dwExtraInfo);
}
"@

    $proc = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    } | Select-Object -First 1

    if (-not $proc) { Write-Error "Open window not found for '$Arg1'"; exit 1 }
    [MouseHelper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null

    $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

    $match = $null
    foreach ($el in $all) {
      $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
      if ($nm -and $nm.ToLower().Equals($elemQuery)) { $match = $el; break }
    }
    if (-not $match) {
      foreach ($el in $all) {
        $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
        if ($nm -and $nm.ToLower().Contains($elemQuery)) { $match = $el; break }
      }
    }
    if (-not $match) { Write-Error "UI element '$Arg2' not found in '$($proc.MainWindowTitle)'"; exit 1 }

    $clicked = $false
    foreach ($pat in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern)) {
      $p = $null
      if ($match.TryGetCurrentPattern($pat, [ref]$p)) {
        if ($pat -eq [System.Windows.Automation.InvokePattern]::Pattern) { $p.Invoke(); $clicked = $true; break }
        if ($pat -eq [System.Windows.Automation.SelectionItemPattern]::Pattern) { $p.Select(); $clicked = $true; break }
        if ($pat -eq [System.Windows.Automation.TogglePattern]::Pattern) { $p.Toggle(); $clicked = $true; break }
      }
    }
    if (-not $clicked) {
      $pt = New-Object System.Windows.Point
      if ($match.TryGetClickablePoint([ref]$pt)) {
        [MouseHelper]::SetCursorPos([int]$pt.X, [int]$pt.Y) | Out-Null
        [MouseHelper]::mouse_event(0x02, 0, 0, 0, 0)
        [MouseHelper]::mouse_event(0x04, 0, 0, 0, 0)
        $clicked = $true
      }
    }
    if (-not $clicked) { Write-Error "Could not invoke or click '$Arg2'"; exit 1 }
    Write-Output "Clicked '$($match.Current.Name)' in '$($proc.MainWindowTitle)'"
  }

  "ui-set-text" {
    $target = $Arg1.Trim().ToLower()
    $elemQuery = $Arg2.Trim().ToLower()
    $val = $Arg3
    if (-not $target -or -not $elemQuery) { Write-Error "App name and element name required"; exit 1 }

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Windows.Forms

    $proc = Get-Process | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and
      ($_.ProcessName.ToLower().Contains($target) -or $_.MainWindowTitle.ToLower().Contains($target))
    } | Select-Object -First 1

    if (-not $proc) { Write-Error "Open window not found for '$Arg1'"; exit 1 }
    $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

    $match = $null
    foreach ($el in $all) {
      $nm = ($el.Current.Name -replace '\s+', ' ').Trim()
      if ($nm -and $nm.ToLower().Contains($elemQuery)) { $match = $el; break }
    }
    if (-not $match) { Write-Error "Input element '$Arg2' not found"; exit 1 }

    $vp = $null
    if ($match.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
      $vp.SetValue($val)
      Write-Output "Set text in '$($match.Current.Name)'"
    } else {
      $match.SetFocus()
      [System.Windows.Forms.SendKeys]::SendWait($val)
      Write-Output "Focused and typed into '$($match.Current.Name)'"
    }
  }

  default {
    Write-Error "Unknown win-apps task: $Task"
    exit 1
  }
}
