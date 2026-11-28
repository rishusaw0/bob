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
  // Common Devanagari command words
  'खोलो': 'open', 'खोल': 'open', 'खोलना': 'open', 'चालू': 'open',
  'बंद': 'close', 'बन्द': 'close',
  'हटाओ': 'remove', 'हटा': 'remove', 'मिटाओ': 'delete', 'डिलीट': 'delete',
  'दिखाओ': 'show', 'दिखा': 'show', 'बताओ': 'batao', 'बता': 'batao',
  'कितना': 'status', 'कितनी': 'status', 'स्थिति': 'status',
  'आवाज़': 'volume', 'आवाज': 'volume', 'वॉल्यूम': 'volume',
  'रोशनी': 'brightness', 'चमक': 'brightness', 'बैटरी': 'battery',
  'वाईफाई': 'wifi', 'वाइफाइ': 'wifi', 'साफ': 'clean', 'साफ़': 'clean',
  'कचरा': 'temp', 'जगह': 'space', 'समय': 'time',
  'बढ़ाओ': 'badhao', 'बढ़ा': 'badha', 'घटाओ': 'ghatao',
  'कम': 'kam', 'ज्यादा': 'zyada', 'ज़्यादा': 'zyada',
  'तेज': 'tez', 'तेज़': 'tez', 'धीमा': 'dheema',
  'बढ़ा दो': 'badhao', 'कम करो': 'kam',
  'करो': 'karo', 'कर': 'kar', 'करना': 'karna',
  'मुझे': 'mujhe', 'मेरा': 'mera', 'मेरी': 'meri',
  'लैपटॉप': 'laptop', 'कंप्यूटर': 'computer', 'स्क्रीन': 'screen',
  'फ़ाइल': 'file', 'फाइल': 'file', 'फ़ोल्डर': 'folder', 'फोल्डर': 'folder',
};

export function normalizeHinglishQuery(text) {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s:%._/\\-]/gu, ' ')
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
    id: 'brightness',
    tool: 'brightness_control',
    args: (raw) => {
      const text = normalizeHinglishQuery(raw);
      const percent = text.match(/\\b(\\d{1,3})\\s*%?/);
      if (/\\b(down|decrease|lower|kam|ghatao)\\b/.test(text)) return { action: 'down' };
      if (percent && Number(percent[1]) <= 100) return { action: 'set', level: Number(percent[1]) };
      if (/\\b(get|status|kitna|kitni)\\b/.test(text)) return { action: 'get' };
      return { action: 'up' };
    },
    phrases: [
      'screen ki brightness badhao', 'laptop brightness badha do',
      'screen roshni tez karo', 'brightness increase display light',
      'screen brightness kam karo', 'brightness decrease',
      'brightness 70 percent set karo', 'screen ki brightness kitni hai',
    ],
  },
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

const INTENT_STOP_WORDS = new Set([
  'please', 'plz', 'hey', 'jeeva', 'zara', 'abhi', 'mere', 'mera', 'meri',
  'the', 'a', 'an', 'is', 'are', 'to', 'for', 'of', 'on', 'in', 'my',
  'hai', 'hain', 'ho', 'raha', 'rahi', 'kar', 'karo', 'karna', 'krna',
  'kro', 'kr', 'do', 'de', 'dena', 'batao', 'btao', 'bata', 'dikhao',
  'please', 'now', 'check', 'tell', 'me', 'kya',
]);

const DESTRUCTIVE_COMMAND_RE =
  /(?:^|\s)(?:delete|remove|uninstall|kill|shutdown|shut\s*down|restart|reboot|format|erase|wipe|hta\s*do|hatao|hata\s*do|mitao|mita\s*do|डिलीट|हटाओ|हटा|मिटाओ)(?=$|\s)/iu;

function semanticContentTokens(text) {
  return normalizeHinglishQuery(text)
    .split(/\s+/)
    .filter((word) => word && !INTENT_STOP_WORDS.has(word));
}

function lexicalCoverage(queryTokens, phraseTokens) {
  if (!queryTokens.length) return 0;
  const phraseSet = new Set(phraseTokens);
  let matched = 0;
  for (const token of queryTokens) {
    if (phraseSet.has(token) || phraseTokens.some((candidate) =>
      token.length >= 4 && candidate.length >= 4 &&
      (candidate.startsWith(token) || token.startsWith(candidate))
    )) matched++;
  }
  return matched / queryTokens.length;
}

/**
 * Returns an explainable match or a safe rejection reason.
 * Low-confidence and near-tie matches are intentionally not routable.
 */
export function classifyIntentDetailed(query, options = {}) {
  const raw = String(query || '').trim();
  const qVec = tokenizeSemantic(raw);
  if (!raw || qVec.size === 0) return { match: null, reason: 'empty', confidence: 0, runnerUp: null };
  if (DESTRUCTIVE_COMMAND_RE.test(raw)) {
    return { match: null, reason: 'unsafe', confidence: 0, runnerUp: null };
  }

  const queryTokens = semanticContentTokens(raw);
  if (!queryTokens.length) return { match: null, reason: 'unknown', confidence: 0, runnerUp: null };

  const ranked = PRECOMPUTED_INTENTS.map((intent) => {
    let bestScore = 0;
    for (let i = 0; i < intent.vectors.length; i++) {
      const phrase = semanticContentTokens(intent.phrases[i]);
      const cosine = cosineSim(qVec, intent.vectors[i]);
      const coverage = lexicalCoverage(queryTokens, phrase);
      // Coverage protects short, clear commands; cosine rewards richer sentence similarity.
      const score = (cosine * 0.58) + (coverage * 0.42);
      if (score > bestScore) bestScore = score;
    }
    return { intent, score: bestScore };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1] || null;
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.43;
  const margin = Number.isFinite(options.margin) ? options.margin : 0.07;
  const confidence = Number(best?.score.toFixed(3) || 0);
  const runnerUp = second ? {
    id: second.intent.id,
    confidence: Number(second.score.toFixed(3)),
  } : null;

  if (!best || best.score < threshold) {
    return { match: null, reason: 'low-confidence', confidence, runnerUp };
  }
  if (second && best.score - second.score < margin) {
    return { match: null, reason: 'ambiguous', confidence, runnerUp };
  }

  return {
    match: {
      id: best.intent.id,
      tool: best.intent.tool,
      confidence,
      args: best.intent.args(raw),
    },
    reason: 'matched',
    confidence,
    runnerUp,
  };
}

export function classifyIntent(query, options = {}) {
  return classifyIntentDetailed(query, options).match;
}

/** Static catalog diagnostics used by tests and developer tooling. */
export function validateIntentCatalog() {
  const ids = new Set();
  const phrases = new Set();
  const issues = [];
  for (const intent of INTENT_DEFINITIONS) {
    if (ids.has(intent.id)) issues.push(`duplicate-id:${intent.id}`);
    ids.add(intent.id);
    for (const phrase of intent.phrases) {
      const normalized = normalizeHinglishQuery(phrase);
      if (phrases.has(normalized)) issues.push(`duplicate-phrase:${normalized}`);
      phrases.add(normalized);
    }
  }
  return { ok: issues.length === 0, issues, intentCount: INTENT_DEFINITIONS.length };
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
