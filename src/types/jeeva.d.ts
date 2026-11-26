// Typed Electron Preload, Tooling, Workflow, Memory RAG & Watchdog Contracts for JEEVA AI

export interface WatchdogAlert {
  id: string;
  kind: 'high_ram' | 'high_cpu' | 'low_disk' | 'low_battery';
  severity: 'high' | 'medium';
  title: string;
  message: string;
  fixAction?: {
    label: string;
    tab?: string;
    command?: string;
  };
  timestamp: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  category: 'preference' | 'project' | 'folder' | 'command' | 'fact';
  tags?: string[];
  updatedAt: number;
  score?: number;
}

export interface WorkflowStep {
  type: 'power_plan' | 'open_app' | 'theme' | 'volume' | 'brightness' | 'minimize_all' | 'clean_temp' | 'diagnostics' | 'run_command';
  app?: string;
  plan?: string;
  mode?: string;
  level?: number;
  command?: string;
}

export interface WorkflowMacro {
  id: string;
  custom?: boolean;
  name: string;
  description?: string;
  trigger?: string;
  condition?: 'always' | 'battery_low' | 'ram_high' | 'cpu_high';
  steps: WorkflowStep[];
}

export interface ElectronBridgeAPI {
  openApp: (name: string, args?: string) => Promise<string>;
  openURL: (url: string) => Promise<string>;
  screenshot: (opts?: { mode?: 'fast' | 'active_window' | 'full' }) => Promise<{ path: string; base64: string; meta?: any }>;
  memoryRag: (sub: 'remember' | 'recall' | 'list' | 'forget', text?: string, category?: string) => Promise<{ items?: MemoryEntry[]; item?: MemoryEntry; success?: boolean }>;
  macros: (sub: 'list' | 'save' | 'delete' | 'dry_run' | 'run', payload?: any, stats?: any) => Promise<any>;
  onWatchdogAlert: (cb: (alert: WatchdogAlert) => void) => () => void;
  getAutoLaunch: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  localBrainStatus: () => Promise<any>;
  localBrainSetup: (action: string, payload?: any) => Promise<any>;
  localBrainStop: () => Promise<any>;
  localBrainChat: (opts: { messages: any[]; tools?: any[]; temperature?: number; maxTokens?: number }) => Promise<any>;
  onLocalBrainProgress: (cb: (ev: any) => void) => () => void;
  episodicLog: (entry: any) => Promise<any>;
  episodicQuery: (filters?: any) => Promise<any[]>;
  episodicSummaries: (days?: number) => Promise<any[]>;
  episodicForgetDay: (dateKey: string) => Promise<{ removed: number }>;
  episodicClear: () => Promise<{ cleared: boolean }>;
  extractDocText: (payload: { filePath?: string; base64?: string; name?: string }) => Promise<any>;
  screenRead: (mode?: 'read' | 'ocr' | 'click_text', targetText?: string) => Promise<any>;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI & Record<string, any>;
  }
}
