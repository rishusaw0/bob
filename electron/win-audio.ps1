param(
  [string]$Action = "get",
  [int]$Level = -1
)

$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    int GetState(out int pdwState);
}

[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
    int GetCount(out uint pcDevices);
    int Item(uint nDevice, out IMMDevice ppDevice);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}

public class WinAudio {
    private static List<IAudioEndpointVolume> GetAllActiveEndpoints() {
        var list = new List<IAudioEndpointVolume>();
        var seen = new HashSet<string>();
        var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
        Guid epvid = typeof(IAudioEndpointVolume).GUID;

        // Include default endpoints for Console (0), Multimedia (1), Communications (2)
        for (int role = 0; role <= 2; role++) {
            try {
                IMMDevice dev;
                if (enumerator.GetDefaultAudioEndpoint(0, role, out dev) == 0 && dev != null) {
                    string id;
                    dev.GetId(out id);
                    if (seen.Add(id)) {
                        object epv;
                        if (dev.Activate(ref epvid, 23, IntPtr.Zero, out epv) == 0 && epv != null) {
                            list.Add(epv as IAudioEndpointVolume);
                        }
                    }
                }
            } catch {}
        }

        // Also include all active render devices (STATE_ACTIVE = 1)
        try {
            IMMDeviceCollection col;
            if (enumerator.EnumAudioEndpoints(0, 1, out col) == 0 && col != null) {
                uint count;
                col.GetCount(out count);
                for (uint i = 0; i < count; i++) {
                    IMMDevice dev;
                    if (col.Item(i, out dev) == 0 && dev != null) {
                        string id;
                        dev.GetId(out id);
                        if (seen.Add(id)) {
                            object epv;
                            if (dev.Activate(ref epvid, 23, IntPtr.Zero, out epv) == 0 && epv != null) {
                                list.Add(epv as IAudioEndpointVolume);
                            }
                        }
                    }
                }
            }
        } catch {}

        return list;
    }

    public static int GetPercent() {
        var eps = GetAllActiveEndpoints();
        if (eps.Count == 0) throw new Exception("No active audio output devices found");
        float level;
        Marshal.ThrowExceptionForHR(eps[0].GetMasterVolumeLevelScalar(out level));
        return (int)Math.Round(level * 100);
    }

    public static bool GetMute() {
        var eps = GetAllActiveEndpoints();
        if (eps.Count == 0) return false;
        bool mute;
        Marshal.ThrowExceptionForHR(eps[0].GetMute(out mute));
        return mute;
    }

    public static int SetPercent(int pct) {
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
        Guid g = Guid.Empty;
        var eps = GetAllActiveEndpoints();
        if (eps.Count == 0) throw new Exception("No active audio output devices found");
        foreach (var ep in eps) {
            try {
                ep.SetMasterVolumeLevelScalar(pct / 100f, ref g);
                ep.SetMute(false, ref g);
            } catch {}
        }
        return GetPercent();
    }

    public static void SetMute(bool mute) {
        Guid g = Guid.Empty;
        foreach (var ep in GetAllActiveEndpoints()) {
            try { ep.SetMute(mute, ref g); } catch {}
        }
    }
}
'@

Add-Type -TypeDefinition $code -Language CSharp

switch ($Action) {
  "get" {
    $pct = [WinAudio]::GetPercent()
    $muted = [WinAudio]::GetMute()
    Write-Output "Volume: $pct% (Muted: $muted)"
  }
  "up" {
    $cur = [WinAudio]::GetPercent()
    $step = if ($Level -gt 0) { $Level } else { 15 }
    $next = [WinAudio]::SetPercent([Math]::Min(100, $cur + $step))
    Write-Output "Volume increased from $cur% to $next%"
  }
  "down" {
    $cur = [WinAudio]::GetPercent()
    $step = if ($Level -gt 0) { $Level } else { 15 }
    $next = [WinAudio]::SetPercent([Math]::Max(0, $cur - $step))
    Write-Output "Volume decreased from $cur% to $next%"
  }
  "set" {
    $next = [WinAudio]::SetPercent($Level)
    Write-Output "Volume set to $next%"
  }
  "mute" {
    [WinAudio]::SetMute($true)
    Write-Output "System volume muted"
  }
  "unmute" {
    [WinAudio]::SetMute($false)
    $pct = [WinAudio]::GetPercent()
    Write-Output "System volume unmuted ($pct%)"
  }
}
