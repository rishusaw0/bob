// Lightweight Toast Notification System
let toastId = 0;
let toasts = [];
let listeners = new Set();

function notify() {
  const snapshot = [...toasts];
  listeners.forEach((fn) => fn(snapshot));
}

export function subscribeToasts(fn) {
  listeners.add(fn);
  fn([...toasts]);
  return () => listeners.delete(fn);
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/**
 * Show a toast notification.
 * @param {string} message - Toast message
 * @param {'success'|'error'|'info'|'warning'} type - Toast type
 * @param {number} duration - Auto-dismiss ms (0 = manual dismiss)
 */
export function toast(message, type = 'info', duration = 3500) {
  const id = ++toastId;
  toasts = [...toasts, { id, message, type, createdAt: Date.now() }];
  if (toasts.length > 5) toasts = toasts.slice(-5);
  notify();

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
  return id;
}

// Convenience shortcuts
toast.success = (msg, ms) => toast(msg, 'success', ms);
toast.error = (msg, ms) => toast(msg, 'error', ms ?? 5000);
toast.warning = (msg, ms) => toast(msg, 'warning', ms ?? 4500);
toast.info = (msg, ms) => toast(msg, 'info', ms);
