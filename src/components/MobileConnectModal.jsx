import { useState, useEffect } from 'react';
import {
  LuX,
  LuSmartphone,
  LuCheck,
  LuUnlink,
  LuCopy,
  LuGlobe,
  LuRefreshCw,
  LuExternalLink,
} from 'react-icons/lu';
import {
  isDesktopElectron,
  getPairedPin,
  getPairedHost,
  getBridgeBaseUrl,
  setBridgeBaseUrl,
  pairWithPC,
  disconnectPhoneBridge,
  checkPCBridgeOnline,
  refreshRenderRelayDevices,
  getSelectedRelayDevice,
  setSelectedRelayDevice,
  getPairToken,
  setPairToken,
  createPairToken,
  createTimedShareToken,
} from '../services/bridge';
import { toast } from '../services/toast';

export default function MobileConnectModal({ isOpen, onClose }) {
  const isDesktop = isDesktopElectron();
  const [desktopTab, setDesktopTab] = useState('cloud'); // 'cloud' | 'lan'
  const [bridgeInfo, setBridgeInfo] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pairedHost, setPairedHost] = useState(() => getPairedHost());
  const [isPaired, setIsPaired] = useState(() => Boolean(getPairedPin()));
  const [pcOnline, setPcOnline] = useState(null);
  const [error, setError] = useState('');
  const [copiedUrl, setCopiedUrl] = useState('');
  const [tempShareBusy, setTempShareBusy] = useState(false);
  const [lastTempShare, setLastTempShare] = useState(null);
  const [bridgeUrl, setBridgeUrl] = useState(() => getBridgeBaseUrl());
  const [checkingBridge, setCheckingBridge] = useState(false);

  // Desktop Cloud Relay state
  const [relayStatus, setRelayStatus] = useState(null);
  const [renderUrlInput, setRenderUrlInput] = useState(
    () => localStorage.getItem('jeeva_last_render_url') || 'https://jeeva-ai.onrender.com'
  );
  const [renderPinInput, setRenderPinInput] = useState('');
  const [desktopPairToken, setDesktopPairToken] = useState('');

  // Web/Phone Cloud Relay state
  const [webPairInput, setWebPairInput] = useState(() => getPairToken());
  const [relayDevices, setRelayDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(() => getSelectedRelayDevice());
  const [loadingDevices, setLoadingDevices] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    if (isDesktop) {
      window.electronAPI?.getBridgeInfo?.().then(setBridgeInfo).catch(() => {});
      window.electronAPI?.relayStatus?.().then((s) => {
        setRelayStatus(s);
        if (s?.renderUrl) setRenderUrlInput(s.renderUrl);
        if (s?.pairToken) setDesktopPairToken(s.pairToken);
      }).catch(() => {});
      const unsub = window.electronAPI?.onRelayStatusChange?.((s) => {
        setRelayStatus(s);
        if (s?.pairToken) setDesktopPairToken(s.pairToken);
      });
      return () => unsub?.();
    } else {
      setWebPairInput(getPairToken());
      const saved = getBridgeBaseUrl();
      setBridgeUrl(saved);
      checkPCBridgeOnline(saved).then(setPcOnline);
      handleRefreshRelay();
    }
  }, [isOpen, isDesktop]);

  if (!isOpen) return null;

  const handleRefreshRelay = async () => {
    setLoadingDevices(true);
    const list = await refreshRenderRelayDevices();
    setRelayDevices(list);
    setSelectedDevice(getSelectedRelayDevice());
    setLoadingDevices(false);
  };

  const handleConnectRelay = async (e) => {
    e.preventDefault();
    setError('');
    const cleanUrl = renderUrlInput.trim().replace(/\/+$/, '');
    if (!cleanUrl) {
      setError('Apna Render URL daalein (e.g. https://jeeva-ai.onrender.com)');
      return;
    }
    localStorage.setItem('jeeva_last_render_url', cleanUrl);
    localStorage.setItem('jeeva_cloud_api_url', cleanUrl);
    window.dispatchEvent(new CustomEvent('jeeva-cloud-url-updated', { detail: cleanUrl }));
    try {
      const s = await window.electronAPI.relayConnect({
        renderUrl: cleanUrl,
        pin: renderPinInput.trim() || undefined,
        pairToken: desktopPairToken.trim() || undefined,
      });
      setRelayStatus(s);
      toast.success('Connecting PC to Render Cloud Relay...');
    } catch (err) {
      setError(err?.message || 'Relay connection failed');
    }
  };

  const handleRegeneratePair = async () => {
    const s = await window.electronAPI?.relayRegeneratePairToken?.();
    if (s?.pairToken) {
      setDesktopPairToken(s.pairToken);
      toast.success('New private Pair Key generated');
    }
  };

  const handleDisconnectRelay = async () => {
    const s = await window.electronAPI?.relayDisconnect?.();
    setRelayStatus(s);
    toast.info('Render Cloud Relay disconnected');
  };

  const handleSaveWebPairToken = () => {
    const clean = webPairInput.trim();
    if (clean && clean.length < 12) {
      setError('Pair Key kam se kam 12 characters ka hona chahiye (jaise JVA-XXXX-XXXX-XXXX)');
      return;
    }
    setError('');
    setPairToken(clean);
    toast.success(clean ? 'Pair Key saved!' : 'Pair Key cleared');
    handleRefreshRelay();
  };

  const handleGenerateWebPairToken = () => {
    const next = createPairToken();
    setWebPairInput(next);
    toast.success('New Pair Key ready — click "1-Click Link PC App" or paste on PC!');
    handleRefreshRelay();
  };

  const handleCheckBridgeUrl = async () => {
    setError('');
    setCheckingBridge(true);
    const cleaned = setBridgeBaseUrl(bridgeUrl);
    setBridgeUrl(cleaned);
    const info = await checkPCBridgeOnline(cleaned);
    setPcOnline(info);
    setCheckingBridge(false);
    if (!info) {
      setError('Local Bridge reachable nahi hai. Wi-Fi URL check karein.');
    }
  };

  const handlePair = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await pairWithPC(pinInput, bridgeUrl);
      setIsPaired(true);
      setPairedHost(res.hostname || 'PC');
      setPinInput('');
      toast.success(`Paired with ${res.hostname || 'PC'}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisconnect = () => {
    disconnectPhoneBridge();
    setIsPaired(false);
    setPairedHost('');
  };

  const handleSelectRelayPC = (dev) => {
    setSelectedRelayDevice(dev.deviceId, dev.hostname);
    setSelectedDevice({ deviceId: dev.deviceId, hostname: dev.hostname });
    toast.success(`Active PC switched to ${dev.hostname}`);
  };

  const copyText = (val, label = 'Copied') => {
    navigator.clipboard.writeText(val);
    setCopiedUrl(val);
    toast.success(label);
    setTimeout(() => setCopiedUrl(''), 1500);
  };

  const desktopShareUrl =
    renderUrlInput.trim() && desktopPairToken
      ? `${renderUrlInput.trim().replace(/\/+$/, '')}/app?pair=${encodeURIComponent(desktopPairToken)}`
      : '';

  const deepLinkUrl =
    typeof window !== 'undefined' && webPairInput.trim().length >= 12
      ? `jeeva://connect?server=${encodeURIComponent(window.location.origin)}&pair=${encodeURIComponent(webPairInput.trim())}`
      : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-obsidian-surface border border-obsidian-border rounded-xl w-full max-w-md mx-4 p-5 shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-obsidian-bg border border-obsidian-border flex items-center justify-center text-obsidian-text">
              <LuGlobe className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-obsidian-text">
                {isDesktop ? 'Remote & Render Link' : 'Connect Your PC'}
              </h3>
              <p className="text-[11px] text-obsidian-muted">
                {isDesktop
                  ? 'Multi-user isolated Cloud Relay or same Wi-Fi LAN'
                  : 'Pair securely using your Private Pair Key'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-obsidian-muted hover:text-obsidian-text hover:bg-obsidian-elevated"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        {isDesktop ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1.5 bg-obsidian-bg p-1 rounded-lg border border-obsidian-border">
              <button
                type="button"
                onClick={() => setDesktopTab('cloud')}
                className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
                  desktopTab === 'cloud'
                    ? 'bg-obsidian-elevated text-obsidian-text'
                    : 'text-obsidian-muted hover:text-obsidian-secondary'
                }`}
              >
                Render Cloud Relay
              </button>
              <button
                type="button"
                onClick={() => setDesktopTab('lan')}
                className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
                  desktopTab === 'lan'
                    ? 'bg-obsidian-elevated text-obsidian-text'
                    : 'text-obsidian-muted hover:text-obsidian-secondary'
                }`}
              >
                Same Wi-Fi LAN
              </button>
            </div>

            {desktopTab === 'cloud' ? (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        relayStatus?.connected
                          ? 'bg-emerald-500'
                          : relayStatus?.connecting
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-zinc-600'
                      }`}
                    />
                    <span className="text-obsidian-secondary">
                      {relayStatus?.connected
                        ? `Online (${relayStatus.hostname})`
                        : relayStatus?.connecting
                        ? 'Connecting to Render...'
                        : 'Cloud Relay Disconnected'}
                    </span>
                  </div>
                  {relayStatus?.deviceId && (
                    <span className="text-[10px] font-mono text-obsidian-muted">{relayStatus.deviceId}</span>
                  )}
                </div>

                {/* Private Pair Key */}
                <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted">
                      Private Pair Key
                    </span>
                    <button
                      type="button"
                      onClick={handleRegeneratePair}
                      className="text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                    >
                      Rotate Key
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={desktopPairToken}
                      onChange={(e) => setDesktopPairToken(e.target.value)}
                      className="flex-1 bg-obsidian-surface border border-obsidian-border rounded px-2.5 py-1 text-xs font-mono text-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => copyText(desktopPairToken, 'Pair Key copied')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-obsidian-elevated border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                    >
                      <LuCopy className="w-3 h-3" />
                      Copy
                    </button>
                  </div>
                  {desktopShareUrl && (
                    <button
                      type="button"
                      onClick={() => copyText(desktopShareUrl, 'Phone/Web auto-pair URL copied!')}
                      className="w-full py-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-[11px] font-medium text-emerald-300"
                    >
                      Copy 1-Click Phone / Web Pair Link
                    </button>
                  )}

                  {renderUrlInput.trim() && desktopPairToken && (
                    <div className="pt-2 border-t border-obsidian-border/60 space-y-1.5">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-obsidian-muted">
                        Expiring Friend Share Links (Time-Limited)
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { label: '30m View Only', ttl: 30, scope: 'read_only' },
                          { label: '1h Full Link', ttl: 60, scope: 'full' },
                          { label: '24h Full Link', ttl: 1440, scope: 'full' },
                        ].map((opt) => (
                          <button
                            key={opt.label}
                            type="button"
                            disabled={tempShareBusy}
                            onClick={async () => {
                              setTempShareBusy(true);
                              setError('');
                              try {
                                const res = await createTimedShareToken({
                                  baseUrl: renderUrlInput.trim(),
                                  pairToken: desktopPairToken.trim(),
                                  ttlMinutes: opt.ttl,
                                  scope: opt.scope,
                                });
                                const shareUrl = `${renderUrlInput.trim().replace(/\/+$/, '')}/app?pair=${encodeURIComponent(res.shareToken)}`;
                                setLastTempShare({ ...res, shareUrl });
                                copyText(shareUrl, `${opt.label} copied!`);
                              } catch (err) {
                                setError(err?.message || 'Could not create timed link (ensure Render Server URL is reachable)');
                              } finally {
                                setTempShareBusy(false);
                              }
                            }}
                            className="px-2 py-1 rounded bg-obsidian-surface hover:bg-obsidian-elevated border border-obsidian-border text-[10px] text-obsidian-secondary hover:text-obsidian-text disabled:opacity-40"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {lastTempShare && (
                        <p className="text-[10px] font-mono text-emerald-300 truncate">
                          Active ({lastTempShare.scope}): {lastTempShare.shareToken}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <form onSubmit={handleConnectRelay} className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] text-obsidian-secondary mb-1">
                      Render Website URL
                    </label>
                    <input
                      type="url"
                      value={renderUrlInput}
                      onChange={(e) => setRenderUrlInput(e.target.value)}
                      placeholder="https://jeeva-ai.onrender.com"
                      className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-xs font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-obsidian-secondary mb-1">
                      Owner PIN (Optional — only if not using Pair Key)
                    </label>
                    <input
                      type="password"
                      value={renderPinInput}
                      onChange={(e) => setRenderPinInput(e.target.value)}
                      placeholder="Leave blank when using Private Pair Key"
                      className="w-full bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-2 text-xs font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  {(error || relayStatus?.lastError) && (
                    <p className="text-xs text-red-400">{error || relayStatus?.lastError}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="flex-1 py-2 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white transition-colors"
                    >
                      {relayStatus?.connected ? 'Reconnect Relay' : 'Connect PC to Render'}
                    </button>
                    {relayStatus?.enabled && (
                      <button
                        type="button"
                        onClick={handleDisconnectRelay}
                        className="px-3 py-2 rounded-lg bg-obsidian-bg border border-obsidian-border text-xs text-red-400 hover:bg-red-950/30"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </form>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3.5">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted mb-2">
                    1. Open on Phone Browser (Same Wi-Fi)
                  </p>
                  {bridgeInfo?.lanIPs?.length ? (
                    <div className="space-y-1.5">
                      {bridgeInfo.lanIPs.map((ip) => {
                        const url = `http://${ip}:${bridgeInfo.port}`;
                        return (
                          <div key={ip} className="flex items-center justify-between gap-2">
                            <code className="text-xs font-mono text-emerald-400">{url}</code>
                            <button
                              onClick={() => copyText(url)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-obsidian-surface border border-obsidian-border text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                            >
                              {copiedUrl === url ? <LuCheck className="w-3 h-3 text-emerald-400" /> : <LuCopy className="w-3 h-3" />}
                              {copiedUrl === url ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-obsidian-muted">No Wi-Fi/LAN IP detected</p>
                  )}
                </div>

                <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3.5 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted">
                      2. Pairing PIN
                    </p>
                    <p className="text-[11px] text-obsidian-secondary mt-0.5">
                      Enter this PIN on your phone once
                    </p>
                  </div>
                  <span className="text-xl font-mono font-bold tracking-widest text-obsidian-text px-3 py-1 rounded-lg bg-obsidian-surface border border-obsidian-border">
                    {bridgeInfo?.pin || '----'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Web/Mobile Private Pair Key + 1-Click Desktop Link */}
            <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted">
                  1. Your Private Pair Key
                </span>
                <button
                  type="button"
                  onClick={handleGenerateWebPairToken}
                  className="text-[11px] text-emerald-400 hover:underline"
                >
                  Generate New Key
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={webPairInput}
                  onChange={(e) => setWebPairInput(e.target.value)}
                  placeholder="JVA-XXXX-XXXX-XXXX"
                  className="flex-1 bg-obsidian-surface border border-obsidian-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-obsidian-text focus:outline-none focus:border-zinc-500"
                />
                <button
                  type="button"
                  onClick={handleSaveWebPairToken}
                  className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-semibold hover:bg-white"
                >
                  Save
                </button>
              </div>
              {deepLinkUrl && (
                <a
                  href={deepLinkUrl}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-xs font-medium text-emerald-300 transition-colors"
                >
                  <LuExternalLink className="w-3.5 h-3.5" />
                  1-Click Link Installed PC App (jeeva://)
                </a>
              )}
            </div>

            {/* Connected PCs for this Pair Key */}
            <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted">
                  2. Connected PCs (Cloud Relay)
                </span>
                <button
                  type="button"
                  onClick={handleRefreshRelay}
                  disabled={loadingDevices}
                  className="inline-flex items-center gap-1 text-[11px] text-obsidian-secondary hover:text-obsidian-text"
                >
                  <LuRefreshCw className={`w-3 h-3 ${loadingDevices ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              {relayDevices.length > 0 ? (
                <div className="space-y-1.5">
                  {relayDevices.map((dev) => {
                    const active = selectedDevice.deviceId === dev.deviceId || relayDevices.length === 1;
                    return (
                      <button
                        key={dev.deviceId}
                        type="button"
                        onClick={() => handleSelectRelayPC(dev)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-colors ${
                          active
                            ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
                            : 'bg-obsidian-surface border-obsidian-border text-obsidian-secondary hover:text-obsidian-text'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <div>
                            <p className="text-xs font-medium">{dev.hostname}</p>
                            <p className="text-[10px] font-mono text-obsidian-muted">{dev.deviceId}</p>
                          </div>
                        </div>
                        {active && <LuCheck className="w-3.5 h-3.5 text-emerald-400" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-obsidian-muted">
                  No PC online for this Pair Key. Install JEEVA Desktop on your PC and enter the same Pair Key.
                </p>
              )}
            </div>

            {/* Direct Wi-Fi / Tunnel Bridge Option */}
            <div className="border-t border-obsidian-border pt-3 space-y-3">
              <p className="text-[11px] font-mono uppercase tracking-wider text-obsidian-muted flex items-center gap-1.5">
                <LuSmartphone className="w-3 h-3" />
                Direct Wi-Fi Bridge (Same Router Optional)
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={bridgeUrl}
                  onChange={(e) => setBridgeUrl(e.target.value)}
                  placeholder="Blank for same Wi-Fi, or custom URL"
                  className="flex-1 bg-obsidian-bg border border-obsidian-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-obsidian-text placeholder:text-obsidian-muted focus:outline-none focus:border-zinc-500"
                />
                <button
                  type="button"
                  onClick={handleCheckBridgeUrl}
                  disabled={checkingBridge}
                  className="px-2.5 py-1.5 rounded-lg bg-obsidian-surface border border-obsidian-border text-xs text-obsidian-text hover:bg-obsidian-elevated disabled:opacity-50"
                >
                  {checkingBridge ? '...' : 'Check'}
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-obsidian-bg border border-obsidian-border">
                <span className={`w-2 h-2 rounded-full ${pcOnline ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                <span className="text-obsidian-secondary">
                  {pcOnline ? `Direct Bridge Online (${pcOnline.hostname})` : 'Direct Wi-Fi Bridge offline'}
                </span>
              </div>

              {isPaired ? (
                <div className="bg-obsidian-bg border border-obsidian-border rounded-lg p-3 flex items-center justify-between">
                  <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                    <LuCheck className="w-3.5 h-3.5" />
                    Wi-Fi Paired ({pairedHost || 'PC'})
                  </p>
                  <button
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-obsidian-surface border border-obsidian-border text-xs text-red-400 hover:bg-red-950/30"
                  >
                    <LuUnlink className="w-3 h-3" />
                    Unlink
                  </button>
                </div>
              ) : (
                <form onSubmit={handlePair} className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={4}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="4-digit PIN"
                    className="w-32 bg-obsidian-bg border border-obsidian-border rounded-lg px-3 py-1.5 text-center font-mono text-xs tracking-widest text-obsidian-text focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={pinInput.length !== 4}
                    className="flex-1 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 text-xs font-medium hover:bg-white disabled:opacity-40"
                  >
                    Pair Direct Bridge
                  </button>
                </form>
              )}
              {error && <p className="text-xs text-red-400">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
