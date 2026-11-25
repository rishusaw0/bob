import { useState, useEffect } from 'react';
import { subscribeToasts, dismissToast } from '../services/toast';
import { LuCheck, LuX, LuCircleAlert, LuInfo } from 'react-icons/lu';

const ICON_MAP = {
  success: LuCheck,
  error: LuX,
  warning: LuCircleAlert,
  info: LuInfo,
};

const COLOR_MAP = {
  success: {
    bg: 'bg-emerald-950/80',
    border: 'border-emerald-800/60',
    icon: 'text-emerald-400',
    text: 'text-emerald-100',
  },
  error: {
    bg: 'bg-red-950/80',
    border: 'border-red-800/60',
    icon: 'text-red-400',
    text: 'text-red-100',
  },
  warning: {
    bg: 'bg-amber-950/80',
    border: 'border-amber-800/60',
    icon: 'text-amber-400',
    text: 'text-amber-100',
  },
  info: {
    bg: 'bg-zinc-800/90',
    border: 'border-zinc-700/60',
    icon: 'text-sky-400',
    text: 'text-zinc-100',
  },
};

function ToastItem({ t, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const colors = COLOR_MAP[t.type] || COLOR_MAP.info;
  const Icon = ICON_MAP[t.type] || LuInfo;

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(t.id), 180);
  };

  return (
    <div
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border backdrop-blur-md shadow-xl transition-all duration-200 ${
        colors.bg
      } ${colors.border} ${
        exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0 animate-fade-in'
      }`}
    >
      <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${colors.icon}`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className={`text-xs font-medium leading-snug flex-1 ${colors.text}`}>
        {t.message}
      </span>
      <button
        onClick={handleDismiss}
        className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 flex-shrink-0"
      >
        <LuX className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-xs w-full pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem t={t} onDismiss={dismissToast} />
        </div>
      ))}
    </div>
  );
}
