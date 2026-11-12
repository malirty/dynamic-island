# Island system bridge. Reads one JSON command per line from stdin, writes one JSON reply per line.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$csharp = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class IslandNative {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();

    static Dictionary<uint, string[]> procCache = new Dictionary<uint, string[]>();

    public static void Init() { try { SetProcessDPIAware(); } catch { } }

    static string[] ProcInfo(uint pid) {
        string[] v;
        if (procCache.TryGetValue(pid, out v)) return v;
        string name = "", desc = "", path = "";
        try {
            Process p = Process.GetProcessById((int)pid);
            name = p.ProcessName;
            try { path = p.MainModule.FileName; desc = p.MainModule.FileVersionInfo.FileDescription ?? ""; } catch { }
        } catch { }
        v = new string[] { name, desc, path };
        if (procCache.Count > 400) procCache.Clear();
        procCache[pid] = v;
        return v;
    }

    // returns: hwnd, pid, process, description, title, class, fullscreen(0/1), exe path
    public static string[] Foreground() {
        IntPtr h = GetForegroundWindow();
        StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
        StringBuilder c = new StringBuilder(256); GetClassName(h, c, 256);
        uint pid; GetWindowThreadProcessId(h, out pid);
        string[] pi = ProcInfo(pid);
        bool full = false;
        string cls = c.ToString();
        if (h != IntPtr.Zero && cls != "Progman" && cls != "WorkerW" && cls != "Shell_TrayWnd") {
            RECT r; GetWindowRect(h, out r);
            MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) {
                full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
            }
        }
        return new string[] { h.ToInt64().ToString(), pid.ToString(), pi[0], pi[1], t.ToString(), cls, full ? "1" : "0", pi[2], GetClipboardSequenceNumber().ToString() };
    }

    public static bool Focus(long hwnd) {
        IntPtr h = new IntPtr(hwnd);
        if (h == IntPtr.Zero || !IsWindow(h)) return false;
        uint dummy;
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
        uint cur = GetCurrentThreadId();
        // A short Alt tap lets this process take foreground rights.
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        AttachThreadInput(fg, cur, true);
        if (IsIconic(h)) ShowWindow(h, 9);
        BringWindowToTop(h);
        bool ok = SetForegroundWindow(h);
        AttachThreadInput(fg, cur, false);
        return ok;
    }

    public static void Combo(int[] vks) {
        foreach (int k in vks) keybd_event((byte)k, 0, 0, UIntPtr.Zero);
        Thread.Sleep(15);
        for (int i = vks.Length - 1; i >= 0; i--) keybd_event((byte)vks[i], 0, 2, UIntPtr.Zero);
    }

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    // Visible top-level windows of a program: "hwnd|title" (a browser shows its tab's title there)
    public static string[] WindowTitles(string name) {
        HashSet<uint> pids = new HashSet<uint>();
        foreach (Process p in Process.GetProcessesByName(name)) pids.Add((uint)p.Id);
        List<string> res = new List<string>();
        if (pids.Count == 0) return res.ToArray();
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            StringBuilder t = new StringBuilder(512); GetWindowText(h, t, 512);
            StringBuilder k = new StringBuilder(256); GetClassName(h, k, 256);
            if (t.Length > 0) res.Add(h.ToInt64() + "|" + k.ToString() + "|" + t.ToString());
            return true;
        }, IntPtr.Zero);
        return res.ToArray();
    }

    public static bool FocusProcess(string name) {
        foreach (Process p in Process.GetProcessesByName(name)) {
            if (p.MainWindowHandle != IntPtr.Zero) return Focus(p.MainWindowHandle.ToInt64());
        }
        return false;
    }

    public static bool Paste(long hwnd) {
        bool ok = true;
        if (hwnd != 0) { ok = Focus(hwnd); Thread.Sleep(90); }
        // release modifiers the user may still hold
        int[] mods = new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C };
        foreach (int m in mods) if ((GetAsyncKeyState(m) & 0x8000) != 0) keybd_event((byte)m, 0, 2, UIntPtr.Zero);
        Combo(new int[] { 0x11, 0x56 });
        return ok;
    }
}

public static class IslandAudio {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
    }
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out uint n);
        [PreserveSig] int Item(uint i, out IMMDevice dev);
    }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    }
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
        [PreserveSig] int GetChannelCount(out uint c);
        [PreserveSig] int SetMasterVolumeLevel(float l, ref Guid g);
        [PreserveSig] int SetMasterVolumeLevelScalar(float l, ref Guid g);
        [PreserveSig] int GetMasterVolumeLevel(out float l);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float l);
        [PreserveSig] int SetChannelVolumeLevel(uint ch, float l, ref Guid g);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint ch, float l, ref Guid g);
        [PreserveSig] int GetChannelVolumeLevel(uint ch, out float l);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint ch, out float l);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
    }
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2 {
        [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
    }
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int n);
        [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
    }
    [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2 {
        [PreserveSig] int GetState(out int s);
        [PreserveSig] int GetDisplayName(out IntPtr n);
        [PreserveSig] int SetDisplayName(IntPtr a, IntPtr b);
        [PreserveSig] int GetIconPath(out IntPtr a);
        [PreserveSig] int SetIconPath(IntPtr a, IntPtr b);
        [PreserveSig] int GetGroupingParam(out Guid a);
        [PreserveSig] int SetGroupingParam(IntPtr a, IntPtr b);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr a);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr a);
        [PreserveSig] int GetSessionIdentifier(out IntPtr a);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr a);
        [PreserveSig] int GetProcessId(out uint pid);
    }
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume {
        [PreserveSig] int SetMasterVolume(float l, ref Guid g);
        [PreserveSig] int GetMasterVolume(out float l);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
    }

    [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation {
        [PreserveSig] int GetPeakValue(out float p);
    }

    static IMMDevice Speakers() {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
        IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
        return dev;
    }
    static IAudioEndpointVolume Endpoint() {
        Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
        Marshal.ThrowExceptionForHR(Speakers().Activate(ref iid, 23, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }
    public static float GetMaster() { float v; Endpoint().GetMasterVolumeLevelScalar(out v); return v; }
    public static void SetMaster(float v) { Guid g = Guid.Empty; Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref g); }
    public static bool GetMute() { bool m; Endpoint().GetMute(out m); return m; }
    public static void SetMute(bool m) { Guid g = Guid.Empty; Endpoint().SetMute(m, ref g); }

    // Each entry: pid|process|volume|muted
    public static string[] Sessions() {
        List<string> res = new List<string>();
        Guid iid = typeof(IAudioSessionManager2).GUID; object o;
        Marshal.ThrowExceptionForHR(Speakers().Activate(ref iid, 23, IntPtr.Zero, out o));
        IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator en; mgr.GetSessionEnumerator(out en);
        int n; en.GetCount(out n);
        for (int i = 0; i < n; i++) {
            IAudioSessionControl2 s; en.GetSession(i, out s);
            uint pid; s.GetProcessId(out pid);
            if (pid == 0) continue;
            string name = "";
            try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
            ISimpleAudioVolume vol = (ISimpleAudioVolume)s;
            float v; vol.GetMasterVolume(out v); bool m; vol.GetMute(out m);
            res.Add(pid + "|" + name + "|" + v.ToString(System.Globalization.CultureInfo.InvariantCulture) + "|" + (m ? 1 : 0));
        }
        return res.ToArray();
    }

    // Apps making sound right now (any player, game or messenger, even without media controls).
    // Each entry: pid|process|peak
    public static string[] Loud() {
        List<string> res = new List<string>();
        Guid iid = typeof(IAudioSessionManager2).GUID; object o;
        Marshal.ThrowExceptionForHR(Speakers().Activate(ref iid, 23, IntPtr.Zero, out o));
        IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator en; mgr.GetSessionEnumerator(out en);
        int n; en.GetCount(out n);
        for (int i = 0; i < n; i++) {
            IAudioSessionControl2 s; en.GetSession(i, out s);
            int st; s.GetState(out st);
            if (st != 1) continue; // only active sessions
            uint pid; s.GetProcessId(out pid);
            if (pid == 0) continue; // system sounds
            float peak = 0;
            try { ((IAudioMeterInformation)s).GetPeakValue(out peak); } catch { }
            if (peak < 0.003f) continue;
            string name = "";
            try { name = Process.GetProcessById((int)pid).ProcessName; } catch { }
            res.Add(pid + "|" + name + "|" + peak.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        return res.ToArray();
    }

    // Default microphone (console + communications roles) mute
    static IAudioEndpointVolume EndpointFor(int flow, int role) {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
        IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(flow, role, out dev));
        Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }
    public static bool GetMicMute() {
        bool m = false;
        try { EndpointFor(1, 2).GetMute(out m); } catch { try { EndpointFor(1, 0).GetMute(out m); } catch { } }
        return m;
    }
    public static void SetMicMute(bool on) {
        Guid g = Guid.Empty;
        try { EndpointFor(1, 0).SetMute(on, ref g); } catch { }
        try { EndpointFor(1, 2).SetMute(on, ref g); } catch { }
    }

    // Mute / unmute everything a process plays (e.g. call audio). Returns sessions touched,
    // or with on < 0 just reports whether all matching sessions are muted (1) or not (0).
    public static int AppMute(string match, int on) {
        int count = 0, muted = 0; match = match.ToLowerInvariant();
        Guid iid = typeof(IAudioSessionManager2).GUID; object o;
        Marshal.ThrowExceptionForHR(Speakers().Activate(ref iid, 23, IntPtr.Zero, out o));
        IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator en; mgr.GetSessionEnumerator(out en);
        int n; en.GetCount(out n);
        for (int i = 0; i < n; i++) {
            IAudioSessionControl2 s; en.GetSession(i, out s);
            uint pid; s.GetProcessId(out pid);
            if (pid == 0) continue;
            string name = "";
            try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
            if (name.Length == 0 || !name.Contains(match)) continue;
            ISimpleAudioVolume vol = (ISimpleAudioVolume)s;
            Guid g = Guid.Empty;
            if (on >= 0) vol.SetMute(on == 1, ref g);
            bool m; vol.GetMute(out m); if (m) muted++;
            count++;
        }
        if (on < 0) return count > 0 && muted == count ? 1 : 0;
        return count;
    }

    // Mute the microphone of one app only: its capture sessions on every active
    // recording device (works with virtual devices like Voicemeeter too).
    // on < 0: report 1 if all of the app's capture sessions are muted.
    public static int AppMicMute(string match, int on) {
        int count = 0, muted = 0; match = match.ToLowerInvariant();
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCo());
        IntPtr colPtr;
        Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(1, 1, out colPtr));
        IMMDeviceCollection col = (IMMDeviceCollection)Marshal.GetObjectForIUnknown(colPtr);
        Marshal.Release(colPtr);
        uint nd; col.GetCount(out nd);
        for (uint d = 0; d < nd; d++) {
            IMMDevice dev; if (col.Item(d, out dev) != 0) continue;
            Guid iid = typeof(IAudioSessionManager2).GUID; object o;
            if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue;
            IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
            int n; se.GetCount(out n);
            for (int i = 0; i < n; i++) {
                IAudioSessionControl2 s; se.GetSession(i, out s);
                uint pid; s.GetProcessId(out pid);
                if (pid == 0) continue;
                string name = "";
                try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
                if (name.Length == 0 || !name.Contains(match)) continue;
                ISimpleAudioVolume vol = (ISimpleAudioVolume)s;
                Guid g = Guid.Empty;
                if (on >= 0) vol.SetMute(on == 1, ref g);
                bool m; vol.GetMute(out m); if (m) muted++;
                count++;
            }
        }
        if (on < 0) return count > 0 && muted == count ? 1 : 0;
        return count;
    }

    public static int SetAppVolume(string match, float level) {
        int count = 0; match = match.ToLowerInvariant();
        Guid iid = typeof(IAudioSessionManager2).GUID; object o;
        Marshal.ThrowExceptionForHR(Speakers().Activate(ref iid, 23, IntPtr.Zero, out o));
        IAudioSessionManager2 mgr = (IAudioSessionManager2)o;
        IAudioSessionEnumerator en; mgr.GetSessionEnumerator(out en);
        int n; en.GetCount(out n);
        for (int i = 0; i < n; i++) {
            IAudioSessionControl2 s; en.GetSession(i, out s);
            uint pid; s.GetProcessId(out pid);
            if (pid == 0) continue;
            string name = "";
            try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { }
            if (name.Length == 0 || !(name.Contains(match) || match.Contains(name))) continue;
            Guid g = Guid.Empty;
            ((ISimpleAudioVolume)s).SetMasterVolume(Math.Max(0f, Math.Min(1f, level)), ref g);
            count++;
        }
        return count;
    }
}

public static class IslandToasts {
    [DllImport("winsqlite3.dll")] static extern int sqlite3_open_v2(byte[] file, out IntPtr db, int flags, IntPtr vfs);
    [DllImport("winsqlite3.dll")] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int n, out IntPtr stmt, IntPtr tail);
    [DllImport("winsqlite3.dll")] static extern int sqlite3_bind_int64(IntPtr stmt, int i, long v);
    [DllImport("winsqlite3.dll")] static extern int sqlite3_step(IntPtr stmt);
    [DllImport("winsqlite3.dll")] static extern long sqlite3_column_int64(IntPtr stmt, int c);
    [DllImport("winsqlite3.dll")] static extern IntPtr sqlite3_column_blob(IntPtr stmt, int c);
    [DllImport("winsqlite3.dll")] static extern int sqlite3_column_bytes(IntPtr stmt, int c);
    [DllImport("winsqlite3.dll")] static extern int sqlite3_finalize(IntPtr stmt);
    [DllImport("winsqlite3.dll")] static extern int sqlite3_close(IntPtr db);

    static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
    static string Col(IntPtr st, int c) {
        int n = sqlite3_column_bytes(st, c); IntPtr p = sqlite3_column_blob(st, c);
        if (n <= 0 || p == IntPtr.Zero) return "";
        byte[] b = new byte[n]; Marshal.Copy(p, b, 0, n); return Encoding.UTF8.GetString(b);
    }

    // Each entry: id \u001f arrival(filetime) \u001f appId \u001f payload xml
    public static string[] Since(string path, long lastId) {
        List<string> res = new List<string>();
        IntPtr db;
        if (sqlite3_open_v2(Z(path), out db, 1, IntPtr.Zero) != 0) { sqlite3_close(db); throw new Exception("cannot open notification db"); }
        try {
            IntPtr st;
            string sql = "SELECT n.Id, n.ArrivalTime, h.PrimaryId, n.Payload FROM Notification n JOIN NotificationHandler h ON n.HandlerId = h.RecordId WHERE n.Id > ?1 AND n.Type = 'toast' ORDER BY n.Id DESC LIMIT 30";
            if (sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero) != 0) throw new Exception("prepare failed");
            sqlite3_bind_int64(st, 1, lastId);
            while (sqlite3_step(st) == 100) {
                res.Add(sqlite3_column_int64(st, 0) + "\u001f" + sqlite3_column_int64(st, 1) + "\u001f" + Col(st, 2) + "\u001f" + Col(st, 3));
            }
            sqlite3_finalize(st);
        } finally { sqlite3_close(db); }
        return res.ToArray();
    }
}
'@

Add-Type -TypeDefinition $csharp -Language CSharp
[IslandNative]::Init()

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
# Like Await, but gives up after $ms (some players never answer, e.g. a seek in a browser)
function AwaitT($op, [Type]$type, [int]$ms) {
    $t = $script:asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    if ($t.Wait($ms)) { return $t.Result }
    return $null
}
function Await($op, [Type]$type) {
    $t = $script:asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $t.Wait(-1)
    $t.Result
}

$script:mediaReady = $false
function Get-MediaManager {
    if (-not $script:mediaReady) {
        $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
        $script:mediaMgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
        $script:mediaReady = $true
    }
    $script:mediaMgr
}

function Get-MediaSession {
    $mgr = Get-MediaManager
    $cur = $mgr.GetCurrentSession()
    # Prefer a session that is actually playing.
    foreach ($s in $mgr.GetSessions()) {
        if ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $s }
    }
    $cur
}

function Cmd-Media($a) {
    $s = Get-MediaSession
    if (-not $s) { return @{ active = $false } }
    # Telegram voice messages carry no title anyway: don't wait long for their description,
    # report the session right away (waiting here delayed the island by several seconds)
    $isTg = $s.SourceAppUserModelId -like '*Telegram*'
    $p = AwaitT ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]) $(if ($isTg) { 600 } else { 3000 })
    if (-not $p -and -not $isTg) { return @{ stale = $true } }
    $pb = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $r = @{
        active   = $true
        app      = $s.SourceAppUserModelId
        title    = $(if ($p) { $p.Title } else { '' })
        artist   = $(if ($p) { $p.Artist } else { '' })
        album    = $(if ($p) { $p.AlbumTitle } else { '' })
        status   = [string]$pb.PlaybackStatus
        position = $tl.Position.TotalSeconds
        duration = $tl.EndTime.TotalSeconds
        updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        canSeek  = $pb.Controls.IsPlaybackPositionEnabled
    }
    if ($a.thumb -and $p -and $p.Thumbnail) {
        try {
            # PowerShell can't bind AsStreamForRead() to a WinRT COM object directly,
            # so invoke it through reflection.
            $ras = AwaitT ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType]) 3000
            if (-not $ras) { throw 'thumbnail timeout' }
            if (-not $script:asStreamForRead) {
                $script:asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
            }
            $st = $script:asStreamForRead.Invoke($null, @($ras))
            $ms = New-Object System.IO.MemoryStream
            $st.CopyTo($ms); $st.Dispose()
            $r.thumb = [Convert]::ToBase64String($ms.ToArray())
        } catch { $r.thumbError = $_.Exception.Message }
    }
    $r
}

function Cmd-MediaCmd($a) {
    # control the very player the island shows (by its app id); otherwise the usual pick
    $s = $null
    if ($a.app) { $s = (Get-MediaManager).GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $a.app } | Select-Object -First 1 }
    if (-not $s) { $s = Get-MediaSession }
    if (-not $s) {
        $vk = @{ toggle = 0xB3; play = 0xB3; pause = 0xB3; next = 0xB0; prev = 0xB1 }[$a.action]
        if ($vk) { [IslandNative]::Combo(@($vk)) }
        return @{ fallback = $true }
    }
    $action = $a.action
    # "toggle" becomes an explicit play or pause: some players (Telegram) accept a toggle but ignore it.
    # The island says what is really going on (it hears the sound); otherwise the player's own status.
    if ($action -eq 'toggle') {
        $isPlaying = if ($null -ne $a.playing) { [bool]$a.playing } else { [string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing' }
        $action = if ($isPlaying) { 'pause' } else { 'play' }
    }
    switch ($action) {
        'toggle' { $op = $s.TryTogglePlayPauseAsync() }
        'play' { $op = $s.TryPlayAsync() }
        'pause' { $op = $s.TryPauseAsync() }
        'next' { $op = $s.TrySkipNextAsync() }
        'prev' { $op = $s.TrySkipPreviousAsync() }
        'seek' { $op = $s.TryChangePlaybackPositionAsync([long]([double]$a.position * 10000000)) }
    }
    $before = [string]$s.GetPlaybackInfo().PlaybackStatus
    $res = AwaitT $op ([bool]) 2500
    if (-not $res -and $a.action -eq 'toggle') {
        # the explicit command was refused: fall back to the player's own toggle
        $res = AwaitT ($s.TryTogglePlayPauseAsync()) ([bool]) 2500
    }
    @{ ok = [bool]$res; timedOut = ($null -eq $res); app = $s.SourceAppUserModelId; before = $before; sent = $action }
}

function Cmd-Ocr($a) {
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($a.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = $null
    if ($a.lang) {
        $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language($a.lang)))
    }
    if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if (-not $engine) { throw 'OCR engine unavailable' }
    $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    @{ text = (($res.Lines | ForEach-Object { $_.Text }) -join "`n"); lang = $engine.RecognizerLanguage.LanguageTag }
}

function Get-Radios {
    $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
    $null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
}

function Cmd-Radios($a) {
    @(Get-Radios | ForEach-Object { @{ kind = [string]$_.Kind; name = $_.Name; state = [string]$_.State } })
}

function Cmd-SetRadio($a) {
    $r = Get-Radios | Where-Object { [string]$_.Kind -eq $a.kind } | Select-Object -First 1
    if (-not $r) { throw "radio not found: $($a.kind)" }
    $state = if ($a.on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
    @{ result = [string](Await ($r.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])) }
}

function Cmd-BtDevices($a) {
    $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
    $sel = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true)
    $list = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
    $out = @()
    foreach ($d in $list) {
        $connected = $false; $kind = ''
        try {
            $bt = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($d.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice])
            if ($bt) { $connected = ([string]$bt.ConnectionStatus) -eq 'Connected'; $kind = [string]$bt.ClassOfDevice.MajorClass; $bt.Dispose() }
        } catch { }
        $out += @{ id = $d.Id; name = $d.Name; connected = $connected; kind = $kind }
    }
    $out
}

function Cmd-SearchFiles($a) {
    $q = ([string]$a.q).Replace("'", "''")
    $limit = if ($a.limit) { [int]$a.limit } else { 12 }
    $conn = New-Object -ComObject ADODB.Connection
    $rs = New-Object -ComObject ADODB.Recordset
    $conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    $sql = "SELECT TOP $limit System.ItemUrl, System.ItemName, System.DateModified FROM SYSTEMINDEX WHERE System.FileName LIKE '%$q%' AND System.ItemType <> 'Directory' ORDER BY System.DateModified DESC"
    $rs.Open($sql, $conn)
    $out = @()
    while (-not $rs.EOF) {
        $out += @{ path = ([string]$rs.Fields.Item('System.ItemUrl').Value -replace '^file:', '').Replace('/', '\'); name = [string]$rs.Fields.Item('System.ItemName').Value }
        $rs.MoveNext()
    }
    $rs.Close(); $conn.Close()
    $out
}

function Cmd-Toasts($a) {
    $rows = [IslandToasts]::Since($a.db, [long]$a.last)
    @($rows | ForEach-Object {
        $p = $_ -split [char]0x1f, 4
        @{ id = [long]$p[0]; arrival = [long]$p[1]; app = $p[2]; xml = $p[3] }
    })
}

function Cmd-Brightness($a) {
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
    @{ level = $b.CurrentBrightness }
}
function Cmd-SetBrightness($a) {
    $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
    $null = Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 0; Brightness = [byte]$a.level }
    @{ ok = $true }
}

function Cmd-Vpn($a) {
    @(Get-VpnConnection -ErrorAction SilentlyContinue | ForEach-Object { @{ name = $_.Name; status = [string]$_.ConnectionStatus; server = $_.ServerAddress } })
}

# Apps currently using the microphone: Windows keeps LastUsedTimeStop = 0 while in use.
function Cmd-MicUsers($a) {
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
    $keys = @()
    $keys += @(Get-ChildItem "$base\NonPackaged" -ErrorAction SilentlyContinue)
    $keys += @(Get-ChildItem $base -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -ne 'NonPackaged' })
    $out = @()
    foreach ($k in $keys) {
        $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
        if ($p -and $p.LastUsedTimeStart -and ($p.LastUsedTimeStop -eq 0)) { $out += [string]$k.PSChildName }
    }
    $out
}

# ---- controlling call apps ----
# Press a real button inside an app (UI Automation): the first pattern that matches a button wins.
# Works in the background (no focus change) for Discord, Telegram, browsers; Zoom draws its own UI.
$script:uiaReady = $false
function Cmd-UiaPress($a) {
    if (-not $script:uiaReady) { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes; $script:uiaReady = $true }
    $AE = [System.Windows.Automation.AutomationElement]  # not $A: PowerShell names ignore case, it would overwrite $a
    $pids = @(Get-Process -Name ([string]$a.proc) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    if (-not $pids.Count) { return @{ ok = $false; reason = 'no process' } }
    $roots = @()
    if ($a.hwnd) { try { $roots += $AE::FromHandle([IntPtr][long]$a.hwnd) } catch { } }
    if (-not $roots.Count) { $roots = @($AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $pids -contains $_.Current.ProcessId }) }
    $btnCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
    $all = @()
    foreach ($r in $roots) { try { $all += @($r.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)) } catch { } }
    foreach ($pat in @($a.names)) {
        foreach ($b in $all) {
            $n = [string]$b.Current.Name
            if (-not $n -or $n -notmatch "(?i)$pat" -or -not $b.Current.IsEnabled) { continue }
            $ip = $null
            if ($b.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$ip)) { $ip.Invoke(); return @{ ok = $true; name = $n } }
            $tp = $null
            if ($b.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) { $tp.Toggle(); return @{ ok = $true; name = $n } }
        }
    }
    @{ ok = $false; reason = 'not found'; buttons = $all.Count }
}
# Zoom doesn't tell anyone whether you're muted, and its buttons aren't visible to UI Automation.
# So look at its window (PrintWindow works under other windows too): when the toolbar is shown
# (its red "Leave" button is at the right end), a red slash on the mic button at the left end = muted.
$script:zoomPixReady = $false
function Cmd-ZoomMic($a) {
    if (-not $script:zoomPixReady) {
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class ZoomPix {
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    public static string State(long hwnd) {
        if (IsIconic((IntPtr)hwnd)) return "unknown";
        RECT r; GetWindowRect((IntPtr)hwnd, out r);
        int w = r.R - r.L, h = r.B - r.T;
        if (w < 300 || h < 200) return "unknown";
        using (Bitmap bmp = new Bitmap(w, h)) {
            using (Graphics g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); PrintWindow((IntPtr)hwnd, dc, 2); g.ReleaseHdc(dc); }
            int y0 = Math.Max(0, h - 76), left = 0, right = 0;
            int lx = Math.Min(260, w / 4), rx = w - Math.Min(320, w / 4);
            for (int y = y0; y < h; y++) {
                for (int x = 0; x < lx; x += 2) { Color c = bmp.GetPixel(x, y); if (c.R > 170 && c.G < 90 && c.B < 90) left++; }
                for (int x = rx; x < w; x += 2) { Color c = bmp.GetPixel(x, y); if (c.R > 170 && c.G < 90 && c.B < 90) right++; }
            }
            if (right < 20) return "unknown"; // toolbar hidden: can't tell
            return left >= 6 ? "muted" : "on";
        }
    }
}
"@
        $script:zoomPixReady = $true
    }
    @{ state = [ZoomPix]::State([long]$a.hwnd) }
}

# Send an app's own shortcut: bring its window forward for a moment, press, give focus back.
function Cmd-SendKeys($a) {
    $prev = [IslandNative]::Foreground()
    $h = [long]$a.hwnd
    if (-not $h) {
        $p = Get-Process -Name ([string]$a.proc) -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
        if ($p) { $h = $p.MainWindowHandle.ToInt64() }
    }
    if (-not $h) { return @{ ok = $false; reason = 'no window' } }
    [void][IslandNative]::Focus($h)
    Start-Sleep -Milliseconds 180
    [IslandNative]::Combo([int[]]@($a.vks))
    Start-Sleep -Milliseconds 150
    if (-not $a.stay -and $prev[0]) { [void][IslandNative]::Focus([long]$prev[0]) }
    @{ ok = $true }
}

function Cmd-StartApps($a) {
    @(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID } })
}

function Dispatch($c, $a) {
    switch ($c) {
        'ping' { return @{ pong = $true } }
        'fg' {
            $f = [IslandNative]::Foreground()
            return @{ hwnd = $f[0]; pid = [int]$f[1]; process = $f[2]; app = $f[3]; title = $f[4]; cls = $f[5]; fullscreen = ($f[6] -eq '1'); exe = $f[7]; clipSeq = [long]$f[8] }
        }
        'focus' { return @{ ok = [IslandNative]::Focus([long]$a.hwnd) } }
        'paste' { return @{ ok = [IslandNative]::Paste([long]$a.hwnd) } }
        'keys' { [IslandNative]::Combo([int[]]$a.vks); return @{ ok = $true } }
        'media' { return Cmd-Media $a }
        'mediaCmd' { return Cmd-MediaCmd $a }
        'loud' { return @([IslandAudio]::Loud() | ForEach-Object { $p = $_ -split '\|'; @{ pid = [int]$p[0]; name = $p[1]; peak = [double]$p[2] } }) }
        'sessions' { return @([IslandAudio]::Sessions() | ForEach-Object { $p = $_ -split '\|'; @{ pid = [int]$p[0]; name = $p[1]; volume = [double]$p[2]; muted = ($p[3] -eq '1') } }) }
        'setAppVolume' { return @{ count = [IslandAudio]::SetAppVolume([string]$a.match, [float]$a.level) } }
        'volume' { return @{ level = [IslandAudio]::GetMaster(); muted = [IslandAudio]::GetMute() } }
        'setVolume' { [IslandAudio]::SetMaster([float]$a.level); return @{ ok = $true } }
        'setMute' { [IslandAudio]::SetMute([bool]$a.on); return @{ ok = $true } }
        'ocr' { return Cmd-Ocr $a }
        'radios' { return Cmd-Radios $a }
        'setRadio' { return Cmd-SetRadio $a }
        'btDevices' { return Cmd-BtDevices $a }
        'searchFiles' { return Cmd-SearchFiles $a }
        'toasts' { return Cmd-Toasts $a }
        'brightness' { return Cmd-Brightness $a }
        'setBrightness' { return Cmd-SetBrightness $a }
        'vpn' { return Cmd-Vpn $a }
        'startApps' { return Cmd-StartApps $a }
        'micUsers' { return @(Cmd-MicUsers $a) }
        'micMute' { return @{ muted = [IslandAudio]::GetMicMute() } }
        'setMicMute' { [IslandAudio]::SetMicMute([bool]$a.on); return @{ muted = [IslandAudio]::GetMicMute() } }
        'appMute' { return @{ muted = ([IslandAudio]::AppMute([string]$a.match, -1) -eq 1) } }
        'appMicMute' { return @{ muted = ([IslandAudio]::AppMicMute([string]$a.match, -1) -eq 1) } }
        'setAppMicMute' { $n = [IslandAudio]::AppMicMute([string]$a.match, $(if ($a.on) { 1 } else { 0 })); return @{ count = $n } }
        'setAppMute' { $n = [IslandAudio]::AppMute([string]$a.match, $(if ($a.on) { 1 } else { 0 })); return @{ count = $n } }
        'focusProcess' { return @{ ok = [IslandNative]::FocusProcess([string]$a.name) } }
        'uiaPress' { return Cmd-UiaPress $a }
        'zoomMic' { return Cmd-ZoomMic $a }
        'sendKeys' { return Cmd-SendKeys $a }
        'windowTitles' { return @([IslandNative]::WindowTitles([string]$a.name) | ForEach-Object { $p = $_.Split([char]'|', 3); @{ hwnd = [long]$p[0]; cls = $p[1]; title = $p[2] } }) }
        'procPath' { $pp = Get-Process -Name ([string]$a.name) -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1; return @{ path = $(if ($pp) { $pp.Path } else { '' }) } }
        default { throw "unknown command: $c" }
    }
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    $id = $null
    try {
        $msg = $line | ConvertFrom-Json
        $id = $msg.id
        $data = Dispatch $msg.cmd $msg.args
        $out = @{ id = $id; ok = $true; data = $data } | ConvertTo-Json -Compress -Depth 8
    } catch {
        $out = @{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress -Depth 4
    }
    [Console]::Out.WriteLine($out)
    [Console]::Out.Flush()
}
