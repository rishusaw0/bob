// Zero-Dependency Bilingual Semantic Intent Classifier & Top-K Tool Picker (Tier-1 Local Brain)

const SYNONYM_MAP = {
  kr: 'kar',
  krna: 'karna',
  kro: 'karo',
  krdo: 'karo',
  karde: 'karo',
  btao: 'batao',
  bta: 'batao',
  dikhao: 'show',
  dikhado: 'show',
  bata: 'batao',
  kholo: 'open',
  khol: 'open',
  chalu: 'open',
  chalao: 'open',
  band: 'close',
  bnd: 'close',
  hatana: 'clean',
  saaf: 'clean',
  kachra: 'temp',
  junk: 'temp',
  dheema: 'slow',
  dhima: 'slow',
  hang: 'slow',
  lag: 'slow',
  atak: 'slow',
  bhar: 'full',
  jada: 'high',
  zyada: 'high',
  kitna: 'status',
  kitni: 'status',
  awaz: 'volume',
  awaaz: 'volume',
  sound: 'volume',
  roshni: 'brightness',
  light: 'brightness',
  yaad: 'remember',
  yadd: 'remember',
  bacha: 'free',
  jagah: 'space',
  smay: 'time',
  samay: 'time',
  waqt: 'time',
  tareekh: 'date',
  tarikh: 'date',
  chal: 'open',
  khula: 'running',
  bata: 'batao',
  dikha: 'show',
  jagah: 'space',
  charge: 'battery',
  charging: 'battery',
};

export function normalizeHinglishQuery(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:%._/\\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  return raw
    .split(' ')
    .map((w) => SYNONYM_MAP[w] || w)
    .join(' ');
}

function tokenizeSemantic(text) {
  const norm = normalizeHinglishQuery(text);
  const words = norm.split(/\s+/).filter(Boolean);
  const feats = new Map();
  for (const w of words) {
    feats.set(`w:${w}`, (feats.get(`w:${w}`) || 0) + 1.5);
    if (w.length >= 4) {
      for (let i = 0; i <= w.length - 3; i++) {
        const g = `g:${w.slice(i, i + 3)}`;
        feats.set(g, (feats.get(g) || 0) + 0.45);
      }
    }
  }
  return feats;
}

function cosineSim(vecA, vecB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const v of vecA.values()) normA += v * v;
  for (const v of vecB.values()) normB += v * v;
  if (!normA || !normB) return 0;
  for (const [k, v] of vecA.entries()) {
    const bv = vecB.get(k);
    if (bv) dot += v * bv;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const INTENT_DEFINITIONS = [
  {
    id: 'system_overview',
    tool: 'system_diagnostics',
    args: () => ({ action: 'overview' }),
    phrases: [
      'laptop hang lag slow ho raha hai check karo',
      'pc health cpu ram disk space kitna free bacha hai',
      'computer speed test hardware status overview',
      'system resource utilization check ram usage',
    ],
  },
  {
    id: 'heavy_processes',
    tool: 'system_diagnostics',
    args: () => ({ action: 'top_processes' }),
    phrases: [
      'kaun sa app sabse zyada ram cpu kha raha hai',
      'heavy processes list dikhao background apps eating memory',
      'top memory consuming programs task manager list',
    ],
  },
  {
    id: 'clean_temp',
    tool: 'file_manager_pro',
    args: () => ({ action: 'clean_temp' }),
    phrases: [
      'temp cache junk kachra files clean saaf karo',
      'temporary files clear disk cleanup free space',
    ],
  },
  {
    id: 'organize_downloads',
    tool: 'file_manager_pro',
    args: () => ({ action: 'organize', source_path: 'downloads' }),
    phrases: [
      'downloads folder arrange organize sort saaf karo',
      'downloads me bikhri files folder wise set karo',
    ],
  },
  {
    id: 'organize_desktop',
    tool: 'file_manager_pro',
    args: () => ({ action: 'organize', source_path: 'desktop' }),
    phrases: [
      'desktop folder arrange organize sort clean karo',
      'desktop icons files foldero me set karo',
    ],
  },
  {
    id: 'battery_check',
    tool: 'get_battery_status',
    args: () => ({}),
    phrases: [
      'laptop battery percentage charging status kitni bachi hai',
      'charger connected hai ya nahi battery check',
    ],
  },
  {
    id: 'wifi_status',
    tool: 'get_wifi_status',
    args: () => ({ mode: 'status' }),
    phrases: [
      'wifi network internet connection kaun sa juda hai',
      'check wifi signal ssid status',
    ],
  },
  {
    id: 'power_saver',
    tool: 'pc_power_tools',
    args: () => ({ action: 'power_plan', plan: 'power_saver' }),
    phrases: [
      'battery bachane ke liye power saver mode eco lagao',
      'switch windows to power saving battery saver plan',
    ],
  },
  {
    id: 'high_performance',
    tool: 'pc_power_tools',
    args: () => ({ action: 'power_plan', plan: 'high_performance' }),
    phrases: [
      'gaming coding fast speed high performance mode lagao',
      'switch windows power plan to high performance boost',
    ],
  },
  {
    id: 'dark_mode',
    tool: 'toggle_windows_theme',
    args: () => ({ mode: 'dark' }),
    phrases: [
      'windows dark mode night theme on lagao',
      'enable dark theme across windows apps',
    ],
  },
  {
    id: 'light_mode',
    tool: 'toggle_windows_theme',
    args: () => ({ mode: 'light' }),
    phrases: [
      'windows light mode day theme on karo',
      'switch windows to light bright theme',
    ],
  },
  {
    id: 'list_timers',
    tool: 'schedule_pc_task',
    args: () => ({ action: 'list' }),
    phrases: [
      'mere kaun se timers reminders scheduled lage hain',
      'list active scheduled tasks reminders',
    ],
  },
  {
    id: 'set_reminder',
    tool: 'schedule_pc_task',
    args: (raw) => {
      const m = String(raw || '').match(/(\d+)\s*(min|minute|minutes|mint|sec|second|hour|hr|ghanta)/i);
      let mins = 10;
      if (m) {
        const val = Number(m[1]);
        if (/hour|hr|ghanta/i.test(m[2])) mins = val * 60;
        else if (/sec/i.test(m[2])) mins = Math.max(0.1, val / 60);
        else mins = val;
      }
      const cleaned = String(raw || '')
        .replace(/(\d+)\s*(min|minute|minutes|mint|sec|second|hour|hr|ghanta)/gi, '')
        .replace(/\b(remind me|yaad dila|reminder|timer|set|laga|lagao|batao|baad|after|ke liye|to|me|dena|karo)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        action: 'reminder',
        delay_minutes: mins,
        message: cleaned || 'JEEVA Reminder',
      };
    },
    phrases: [
      '10 minute baad paani peene ka timer reminder lagao',
      'remind me after 15 minutes yaad dila dena alarm',
    ],
  },
  {
    id: 'clipboard_list',
    tool: 'clipboard_history',
    args: () => ({ action: 'list' }),
    phrases: [
      'maine abhi kya copy kiya tha clipboard history dikhao',
      'recent copied items paste history list',
    ],
  },
  {
    id: 'running_apps',
    tool: 'get_running_apps',
    args: () => ({}),
    phrases: [
      'abhi pc me kaun se apps windows khule hain',
      'list currently running open programs windows',
    ],
  },
  {
    id: 'installed_apps',
    tool: 'list_installed_software',
    args: () => ({}),
    phrases: [
      'laptop me kaun kaun se software programs installed hain',
      'list installed applications packages on pc',
    ],
  },
];

const PRECOMPUTED_INTENTS = INTENT_DEFINITIONS.map((def) => ({
  ...def,
  vectors: def.phrases.map((p) => tokenizeSemantic(p)),
}));

export function classifyIntent(query) {
  const qVec = tokenizeSemantic(query);
  if (qVec.size === 0) return null;

  // Never auto-route explicitly destructive intents without confirmation or full context
  const lower = String(query || '').toLowerCase();
  if (/\b(delete|remove|uninstall|kill|shutdown|restart|reboot|format|erase|hta do|hatao)\b/i.test(lower)) {
    return null;
  }

  let best = null;
  for (const intent of PRECOMPUTED_INTENTS) {
    let topScore = 0;
    for (const v of intent.vectors) {
      const s = cosineSim(qVec, v);
      if (s > topScore) topScore = s;
    }
    if (!best || topScore > best.confidence) {
      best = {
        id: intent.id,
        tool: intent.tool,
        confidence: Number(topScore.toFixed(3)),
        args: intent.args(query),
      };
    }
  }
  return best;
}

const TOOL_DESCRIPTIONS = {
  open_application: 'open launch start application chrome vscode notepad spotify calculator terminal',
  close_application: 'close exit quit stop running app window process',
  get_running_apps: 'list open running applications windows tasks',
  open_url: 'open website url link youtube google github in browser',
  search_web: 'search google web query online information',
  browser_control: 'browser tabs switch new close tab read active page youtube skip ad',
  control_volume: 'volume sound audio awaz mute unmute speaker percentage up down',
  media_control: 'music song video play pause next previous stop media playback',
  brightness_control: 'screen brightness roshni display dim bright percentage',
  open_windows_setting: 'windows settings wifi bluetooth display sound update privacy',
  toggle_windows_theme: 'dark mode light mode theme windows appearance',
  get_battery_status: 'battery charge percentage laptop power adapter status',
  get_wifi_status: 'wifi network ssid internet connection status off',
  press_shortcut: 'keyboard shortcut hotkey minimize win+d alt+tab switch windows',
  system_power: 'lock sleep shutdown restart reboot pc power state',
  take_screenshot: 'screenshot capture screen image photo dekho',
  get_system_info: 'system pc info hardware cpu ram specs username uptime',
  manage_clipboard: 'clipboard copy paste read write text',
  type_text: 'type write text paste into active window keyboard',
  save_desktop_note: 'save note summary text markdown file desktop',
  file_operation: 'file folder list read write search delete directory path',
  read_document_file: 'read pdf docx pptx xlsx word excel powerpoint document summarize',
  run_system_command: 'run terminal powershell cmd command shell script',
  list_installed_software: 'list installed software apps programs winget',
  manage_software: 'install uninstall update software app package winget',
  control_app_window: 'focus minimize maximize snap move app window',
  system_diagnostics: 'cpu ram gpu disk storage speed lag slow health top processes ports kill pid',
  file_manager_pro: 'organize downloads desktop folder clean temp cache zip unzip move rename',
  clipboard_history: 'clipboard copied history list paste item',
  schedule_pc_task: 'timer reminder alarm schedule delayed command after minutes',
  pc_power_tools: 'power plan balanced high performance power saver display info recycle bin',
  memory_rag: 'remember recall memory preference project path past fact',
  episodic_recall: 'what did i ask say yesterday last week monday date history timeline morning evening',
  screen_reader: 'read active screen visible text buttons ocr click element type into window screen reader',
};

const PRECOMPUTED_TOOL_VECS = Object.entries(TOOL_DESCRIPTIONS).map(([name, desc]) => ({
  name,
  vec: tokenizeSemantic(desc),
}));

/**
 * Selects the Top K relevant tools for a user query so tiny 0.5B-3B local models stay fast & accurate.
 */
export function pickTopToolsForQuery(query, k = 4) {
  const qVec = tokenizeSemantic(query);
  const scored = PRECOMPUTED_TOOL_VECS.map((item) => ({
    name: item.name,
    score: cosineSim(qVec, item.vec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, k)).map((x) => x.name);
}
