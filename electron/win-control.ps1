param(
  [string]$Task = "brightness-get",
  [string]$Arg1 = "",
  [int]$Num1 = -1
)

switch ($Task) {
  "brightness-get" {
    try {
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
      Write-Output "Brightness: $($b.CurrentBrightness)%"
    } catch {
      Write-Error "Brightness reading not supported on this display."
      exit 1
    }
  }
  "brightness-set" {
    $val = [Math]::Max(0, [Math]::Min(100, $Num1))
    try {
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$val } | Out-Null
      Write-Output "Brightness set to $val%"
    } catch {
      Write-Error "Brightness control failed: $($_.Exception.Message)"
      exit 1
    }
  }
  "brightness-up" {
    try {
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
      $step = if ($Num1 -gt 0) { $Num1 } else { 15 }
      $val = [Math]::Min(100, [int]$b.CurrentBrightness + $step)
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$val } | Out-Null
      Write-Output "Brightness increased from $($b.CurrentBrightness)% to $val%"
    } catch {
      Write-Error "Brightness control failed: $($_.Exception.Message)"
      exit 1
    }
  }
  "brightness-down" {
    try {
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
      $step = if ($Num1 -gt 0) { $Num1 } else { 15 }
      $val = [Math]::Max(0, [int]$b.CurrentBrightness - $step)
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$val } | Out-Null
      Write-Output "Brightness decreased from $($b.CurrentBrightness)% to $val%"
    } catch {
      Write-Error "Brightness control failed: $($_.Exception.Message)"
      exit 1
    }
  }
  "open-app" {
    $q = $Arg1.Trim()
    $launchArg = $Arg2.Trim()
    if (-not $q) { Write-Error "Missing app name"; exit 1 }

    $aliases = @{
      "chrome" = "chrome"
      "google chrome" = "chrome"
      "edge" = "msedge"
      "microsoft edge" = "msedge"
      "notepad" = "notepad"
      "calculator" = "calc"
      "calc" = "calc"
      "explorer" = "explorer"
      "file explorer" = "explorer"
      "cmd" = "cmd"
      "powershell" = "powershell"
      "task manager" = "taskmgr"
      "paint" = "mspaint"
      "settings" = "ms-settings:"
      "store" = "ms-windows-store:"
      "microsoft store" = "ms-windows-store:"
      "word" = "winword"
      "excel" = "excel"
      "powerpoint" = "powerpnt"
      "vscode" = "code"
      "vs code" = "code"
      "code" = "code"
      "spotify" = "spotify"
      "vlc" = "vlc"
      "whatsapp" = "whatsapp:"
      "telegram" = "telegram"
      "discord" = "discord"
      "terminal" = "wt"
      "wt" = "wt"
      "windows terminal" = "wt"
    }

    $lower = $q.ToLower()
    if ($aliases.ContainsKey($lower)) {
      try {
        if ($launchArg) { Start-Process $aliases[$lower] -ArgumentList $launchArg -ErrorAction Stop }
        else { Start-Process $aliases[$lower] -ErrorAction Stop }
        Write-Output "Opened $q"
        exit 0
      } catch {}
    }

    $startApps = Get-StartApps | Where-Object { $_.Name -like "*$q*" } | Select-Object -First 1
    if ($startApps) {
      Start-Process ("shell:AppsFolder\" + $startApps.AppID)
      Write-Output "Opened $($startApps.Name)"
      exit 0
    }

    $dirs = @(
      "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
      "$env:ProgramData\Microsoft\Windows\Start Menu\Programs"
    )
    foreach ($d in $dirs) {
      if (Test-Path $d -ErrorAction SilentlyContinue) {
        $lnk = Get-ChildItem -Path $d -Recurse -Filter "*$q*.lnk" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($lnk) {
          if ($launchArg) { Start-Process $lnk.FullName -ArgumentList $launchArg }
          else { Start-Process $lnk.FullName }
          Write-Output "Opened $($lnk.BaseName)"
          exit 0
        }
      }
    }

    try {
      if ($launchArg) { Start-Process $q -ArgumentList $launchArg -ErrorAction Stop }
      else { Start-Process $q -ErrorAction Stop }
      Write-Output "Opened $q"
    } catch {
      Write-Error "Could not find or open application '$q': $($_.Exception.Message)"
      exit 1
    }
  }
  "theme" {
    $path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
    $cur = (Get-ItemProperty -Path $path -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme
    $newVal = if ($Arg1 -eq "dark") { 0 } elseif ($Arg1 -eq "light") { 1 } else { if ($cur -eq 1) { 0 } else { 1 } }
    Set-ItemProperty -Path $path -Name AppsUseLightTheme -Value $newVal
    Set-ItemProperty -Path $path -Name SystemUsesLightTheme -Value $newVal
    $modeName = if ($newVal -eq 0) { "Dark Mode" } else { "Light Mode" }
    Write-Output "Windows theme switched to $modeName"
  }
  "battery" {
    $bat = $null
    try {
      $bat = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
    } catch {}
    if ($bat) {
      $status = switch ($bat.BatteryStatus) { 2 { "Charging (AC)" } 1 { "Discharging" } default { "Status $($bat.BatteryStatus)" } }
      Write-Output "Battery: $($bat.EstimatedChargeRemaining)% ($status)"
    } else {
      try {
        Add-Type -AssemblyName System.Windows.Forms
        $ps = [System.Windows.Forms.SystemInformation]::PowerStatus
        if ($ps.BatteryChargeStatus -band [System.Windows.Forms.BatteryChargeStatus]::NoSystemBattery) {
          Write-Output "No battery detected (Desktop PC / AC Power)"
        } else {
          $pct = [int][math]::Round($ps.BatteryLifePercent * 100)
          $ac = if ($ps.PowerLineStatus -eq [System.Windows.Forms.PowerLineStatus]::Online) { "Charging (AC)" } else { "Discharging" }
          Write-Output "Battery: $pct% ($ac)"
        }
      } catch {
        Write-Output "Battery information unavailable"
      }
    }
  }
  "wifi" {
    if ($Arg1 -eq "on" -or $Arg1 -eq "off") {
      # Match physical 802.11 adapters without assuming an English adapter name ("Wi-Fi").
      $wifiAdapters = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object {
        $_.NdisPhysicalMedium -eq 9 -or $_.InterfaceDescription -match '802\.11|wireless|wi-?fi'
      })
      if ($wifiAdapters.Count -eq 0) {
        throw "No physical Wi-Fi adapter was found."
      }
      foreach ($adapter in $wifiAdapters) {
        if ($Arg1 -eq "on") {
          Enable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop | Out-Null
        } else {
          Disable-NetAdapter -Name $adapter.Name -Confirm:$false -ErrorAction Stop | Out-Null
        }
      }
      Write-Output ("Wi-Fi adapter(s) " + $Arg1 + " operation completed.")
    } elseif ($Arg1 -eq "disconnect") {
      netsh wlan disconnect | Out-Null
      Write-Output "Wi-Fi disconnected"
    } else {
      $info = netsh wlan show interfaces
      Write-Output ($info -join "`n")
    }
  }
  "minimize-all" {
    $shell = New-Object -ComObject Shell.Application
    $shell.MinimizeAll()
    Write-Output "Minimized all windows"
  }
  "restore-all" {
    $shell = New-Object -ComObject Shell.Application
    $shell.UndoMinimizeALL()
    Write-Output "Restored all windows"
  }
  "keyboard" {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait($Arg1)
    Write-Output "Sent keyboard sequence"
  }
  default {
    Write-Error "Unknown task: $Task"
    exit 1
  }
}
