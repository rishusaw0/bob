// Layer-1 Deterministic Bilingual Slot Extractors for PC Commands (0 Gemini API calls)
import { executeFunctionCall } from './tools.js';
import { runLocalDocumentPathTurn } from './docExtractor.js';

function replyByLang(lang, en, hiMix, hi) {
  if (lang === 'english') return en;
  if (lang === 'hindi') return hi;
  return hiMix;
}

const WINDOWS_SETTING_ALIASES = [
  ['windowsupdate', /\b(windows update|system update|update settings)\b/i],
  ['bluetooth', /\b(bluetooth|bt)\b/i],
  ['wifi', /\b(wifi|wi-fi)\b/i],
  ['display', /\b(display|screen resolution|monitor settings)\b/i],
  ['sound', /\b(sound|audio|speaker settings|output device)\b/i],
  ['battery', /\b(battery settings|power & battery)\b/i],
  ['power', /\b(power settings|sleep settings)\b/i],
  ['storage', /\b(storage settings|disk cleanup settings)\b/i],
  ['apps', /\b(apps settings|installed apps settings|default apps)\b/i],
  ['privacy', /\b(privacy|security settings)\b/i],
  ['notifications', /\b(notification|notifications)\b/i],
  ['personalization', /\b(personalization|wallpaper|background settings)\b/i],
  ['theme', /\b(theme settings|colors settings)\b/i],
  ['hotspot', /\b(hotspot|mobile hotspot)\b/i],
  ['airplane', /\b(airplane|flight mode)\b/i],
  ['vpn', /\b(vpn)\b/i],
  ['camera', /\b(camera settings)\b/i],
  ['mic', /\b(mic settings|microphone settings)\b/i],
  ['keyboard', /\b(keyboard settings)\b/i],
  ['mouse', /\b(mouse settings|touchpad settings)\b/i],
  ['time', /\b(date and time|time settings)\b/i],
  ['about', /\b(about pc|about system|pc specs)\b/i],
];

const MONTH_MAP = {
  jan: 0, january: 0, janwari: 0,
  feb: 1, february: 1, farwari: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, sitambar: 8,
  oct: 9, october: 9, octobar: 9, aktubar: 9,
  nov: 10, november: 10, navambar: 10,
  dec: 11, december: 11, decembar: 11, desembor: 11, disambar: 11,
};

function toLocalDateKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseClockTimeFromText(lower, baseDate) {
  let hour = null;
  let minute = 0;
  let hasExplicitTime = false;

  const amPmMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const bajeMatch = lower.match(/\b(?:(subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night)\s+)?(\d{1,2})(?::(\d{2}))?\s*baje(?:\s+(subah|shaam|sham|raat))?\b/i);
  const hhmmMatch = lower.match(/\b(\d{1,2}):(\d{2})\b/);

  if (amPmMatch) {
    hasExplicitTime = true;
    hour = Number(amPmMatch[1]);
    minute = Number(amPmMatch[2] || 0);
    const mer = amPmMatch[3].toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
  } else if (bajeMatch) {
    hasExplicitTime = true;
    hour = Number(bajeMatch[2]);
    minute = Number(bajeMatch[3] || 0);
    const hint = (bajeMatch[1] || bajeMatch[4] || '').toLowerCase();
    if (/shaam|sham|evening|raat|night|dopahar|afternoon/.test(hint)) {
      if (hour < 12) hour += 12;
    } else if (/subah|morning/.test(hint)) {
      if (hour === 12) hour = 0;
    } else if (hour >= 1 && hour <= 11) {
      // Smart fallback for "6 baje" without AM/PM: if today and AM already passed, use PM
      const now = new Date();
      const isToday = toLocalDateKey(baseDate.getTime()) === toLocalDateKey(now.getTime());
      if (isToday && (now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute))) {
        hour += 12;
      } else if (hour <= 7) {
        hour += 12;
      }
    }
  } else if (hhmmMatch && /\b(at|par|time|baje)\b/i.test(lower)) {
    hasExplicitTime = true;
    hour = Number(hhmmMatch[1]);
    minute = Number(hhmmMatch[2]);
  }

  return { hasExplicitTime, hour, minute };
}

function parseDateTimeReminder(cleanText) {
  const clean = String(cleanText || '').trim();
  const lower = clean.toLowerCase();
  if (!/\b(remind|reminder|yaad dilana|yaad dila|yaad dilao|yaad rakhna|alarm|timer)\b/i.test(lower)) {
    return null;
  }

  const now = new Date();
  let targetDate = null;

  const monthRegex = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTH_MAP).join('|')})(?:\\s+(\\d{4}))?\\b`, 'i');
  const dmMatch = lower.match(monthRegex);
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);

  if (isoMatch) {
    targetDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  } else if (dmMatch) {
    const day = Number(dmMatch[1]);
    const month = MONTH_MAP[dmMatch[2].toLowerCase()];
    let year = dmMatch[3] ? Number(dmMatch[3]) : now.getFullYear();
    const candidate = new Date(year, month, day, 23, 59, 0);
    if (!dmMatch[3] && candidate.getTime() < now.getTime()) year += 1;
    targetDate = new Date(year, month, day);
  } else if (/\b(parso|day after tomorrow)\b/i.test(lower)) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  } else if (/\b(kal|tomorrow)\b/i.test(lower)) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (/\b(aaj|ajj|today)\b/i.test(lower)) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const timeParsed = parseClockTimeFromText(lower, targetDate || now);
  if (!targetDate && !timeParsed.hasExplicitTime) return null;
  if (!targetDate) {
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (timeParsed.hasExplicitTime && timeParsed.hour !== null) {
    targetDate.setHours(Math.min(23, Math.max(0, timeParsed.hour)), Math.min(59, Math.max(0, timeParsed.minute)), 0, 0);
    if (targetDate.getTime() <= now.getTime() && !dmMatch && !isoMatch && !/\b(aaj|ajj|today)\b/i.test(lower)) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
  } else {
    // Date-only reminder: default 9:00 AM on that calendar date (or +2 min if today already past 9 AM)
    targetDate.setHours(9, 0, 0, 0);
    if (targetDate.getTime() <= now.getTime()) {
      targetDate = new Date(now.getTime() + 2 * 60 * 1000);
    }
  }

  if (targetDate.getTime() <= now.getTime()) {
    targetDate = new Date(now.getTime() + 60 * 1000);
  }

  const msgCleaned = clean
    .replace(/\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|january|janwari|feb|february|farwari|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|sitambar|oct|october|octobar|aktubar|nov|november|navambar|dec|december|decembar|desembor|disambar)(?:\s+\d{4})?)\b/gi, ' ')
    .replace(/\b(\d{4}-\d{2}-\d{2}|aaj|ajj|today|kal|tomorrow|parso|day after tomorrow)\b/gi, ' ')
    .replace(/\b(?:subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)(?:\s+(?:subah|shaam|sham|raat))?\b/gi, ' ')
    .replace(/\b(remind me|reminder|yaad dilana|yaad dila dena|yaad dilao|yaad rakhna|lagao|set karo|rakhna|bata dena|ki|ke|ko|ka|hai|hamko|mujhe|karna)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const message = msgCleaned.length >= 2 ? msgCleaned : 'Scheduled Reminder';
  const dateKey = toLocalDateKey(targetDate.getTime());
  const timeLabel = timeParsed.hasExplicitTime
    ? targetDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : '9:00 AM';

  return {
    triggerAt: targetDate.getTime(),
    dateKey,
    hasExplicitTime: timeParsed.hasExplicitTime,
    timeLabel,
    message,
    earlyWarnMinutes: timeParsed.hasExplicitTime ? 30 : 0,
  };
}

async function runSlotTool(toolName, args, requestPermission, cleanText, fallbackSuccess) {
  const res = await executeFunctionCall(toolName, args, requestPermission, {
    fromVoice: false,
    userPrompt: cleanText,
  });
  const ok = !res?.error;
  const text = ok
    ? typeof res?.result === 'string' && res.result.trim()
      ? res.result.trim()
      : fallbackSuccess
    : String(res.error);
  return {
    handled: true,
    tier: 'fast',
    modelLabel: 'Local Command Engine',
    routeReason: 'Executed parameterized PC command locally (0 Gemini API calls)',
    replyText: text,
    tools: [{ name: toolName, status: ok ? 'done' : 'error', args }],
  };
}

/**
 * Extracts parameters & runs everyday PC commands directly in JS with 0 LLM tokens and 0 API calls.
 */
export async function tryLocalSlotAction(cleanText, lang, requestPermission = null) {
  const clean = String(cleanText || '').trim();
  const lower = clean.toLowerCase();
  if (!clean) return null;

  // 0. Voice/Chat File-Location PDF/DOCX/TXT Reader & Summarizer ("Desktop par notes.pdf padh kar sunao / summarize karo")
  if (/\b(read|padh|padho|sunao|samjhao|explain|summary|summarize|summarise)\b/i.test(lower)) {
    const absDocMatch = clean.match(/([A-Za-z]:\\[^\n"']+\.(?:pdf|docx|pptx|xlsx|txt|md))/i);
    const folderExtMatch =
      clean.match(/\b(desktop|downloads|documents)\s+(?:par|pe|mein|me|in|on)\s+["']?([a-z0-9\s._-]{2,60}?\.(?:pdf|docx|pptx|xlsx|txt|md))["']?/i) ||
      clean.match(/["']?([a-z0-9\s._-]{2,60}?\.(?:pdf|docx|pptx|xlsx|txt|md))["']?\s+(?:in|on|from|at|mein|me|par|pe)\s+(desktop|downloads|documents)\b/i);
    const folderTypeMatch = clean.match(/\b(desktop|downloads|documents)\s+(?:par|pe|mein|me|in|on)\s+["']?([a-z0-9\s._-]{2,40}?)["']?\s+(?:pdf|docx|document|file)\b/i);

    let targetPath = '';
    if (absDocMatch?.[1]) {
      targetPath = absDocMatch[1].trim();
    } else if (folderExtMatch) {
      const isFolderFirst = /^(desktop|downloads|documents)$/i.test(folderExtMatch[1]);
      const folder = (isFolderFirst ? folderExtMatch[1] : folderExtMatch[2]).toLowerCase();
      const file = (isFolderFirst ? folderExtMatch[2] : folderExtMatch[1]).trim();
      targetPath = `${folder}/${file}`;
    } else if (folderTypeMatch) {
      targetPath = `${folderTypeMatch[1].toLowerCase()}/${folderTypeMatch[2].trim()}`;
    }

    if (targetPath) {
      const docRes = await runLocalDocumentPathTurn({
        filePath: targetPath,
        userPrompt: clean,
        requestPermission,
        fromVoice: true,
      });
      if (docRes?.handled) return docRes;
    }
  }

  // 1. Reminders & Timers (Calendar Dates + Clock Times + 30-min Early Warning + 90-day Catchup)
  if (/\b(aaj ka agenda|missed reminders|kya yaad dilana|active reminders|list reminders|reminders dikhao|scheduled tasks|meri timers)\b/i.test(lower)) {
    const agendaRes = await runSlotTool('schedule_pc_task', { action: 'agenda' }, requestPermission, clean, '');
    return agendaRes;
  }
  if (/\b(cancel all reminders|sab reminder cancel|reminders band|clear reminders)\b/i.test(lower)) {
    return runSlotTool(
      'schedule_pc_task',
      { action: 'cancel', task_id: 'all' },
      requestPermission,
      clean,
      replyByLang(lang, 'All reminders cancelled.', 'Sabhi reminders cancel kar diye hain.', 'सभी रिमाइंडर रद्द कर दिए हैं।')
    );
  }

  const dateRem = parseDateTimeReminder(clean);
  if (dateRem) {
    const res = await runSlotTool(
      'schedule_pc_task',
      {
        action: 'remind_date',
        trigger_at: dateRem.triggerAt,
        date_key: dateRem.dateKey,
        has_explicit_time: dateRem.hasExplicitTime,
        time_label: dateRem.timeLabel,
        early_warn_minutes: dateRem.earlyWarnMinutes,
        message: dateRem.message,
      },
      requestPermission,
      clean,
      ''
    );
    const humanDate = new Date(dateRem.triggerAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const earlyNote = dateRem.hasExplicitTime ? ' Main 30 minute pehle bhi alert dunga,' : '';
    return {
      ...res,
      replyText: replyByLang(
        lang,
        `Saved reminder for ${humanDate} at ${dateRem.timeLabel}: "${dateRem.message}".${dateRem.hasExplicitTime ? ' I will also alert you 30 minutes before.' : ''}`,
        `${humanDate} (${dateRem.timeLabel}) ke liye yaad rakh liya: "${dateRem.message}".${earlyNote} aur agar PC band raha to agle startup par zaroor bataunga (90 din tak saved).`,
        `${humanDate} (${dateRem.timeLabel}) के लिए सेव कर दिया: "${dateRem.message}"।`
      ),
    };
  }

  const timerMatch =
    clean.match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|मिनट)\b[\s\S]*?\b(?:baad|after|later|ka|for|to)?\s*(?:reminder|timer|alarm|yaad)?[:\s-]*(.*)$/i) ||
    clean.match(/\bremind\s+me\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)\s*(?:to|about|for)?\s*(.*)$/i);
  if (timerMatch && /\b(remind|reminder|timer|alarm|yaad)\b/i.test(lower)) {
    const mins = Math.max(0.1, Number(timerMatch[1]) || 5);
    const tailMsg = String(timerMatch[2] || '')
      .replace(/\b(lagao|set karo|karo|rakhna|bata dena|reminder|timer|alarm)\b/gi, '')
      .trim();
    const message = tailMsg.length >= 2 ? tailMsg : 'Scheduled Reminder';
    return runSlotTool(
      'schedule_pc_task',
      { action: 'remind', delay_minutes: mins, message },
      requestPermission,
      clean,
      replyByLang(
        lang,
        `Reminder set for ${mins} min: "${message}".`,
        `${mins} minute ka reminder lagaya gaya: "${message}".`,
        `${mins} मिनट का रिमाइंडर सेट कर दिया: "${message}"।`
      )
    );
  }

  // 1.5 Advanced VS Code, GitHub, Chrome & YouTube Controls (100% Local)
  if (/\b(youtube)\b/i.test(lower) && /\b(mute|unmute|fullscreen|full screen|theater|theatre|caption|captions|subtitle|subtitles|forward|aage|rewind|peeche|speed up|tez|speed down|dheema|previous|pichla)\b/i.test(lower)) {
    const ytAction = /\b(mute|unmute)\b/i.test(lower)
      ? 'youtube_mute'
      : /\b(fullscreen|full screen)\b/i.test(lower)
        ? 'youtube_fullscreen'
        : /\b(theater|theatre)\b/i.test(lower)
          ? 'youtube_theater'
          : /\b(caption|captions|subtitle|subtitles)\b/i.test(lower)
            ? 'youtube_captions'
            : /\b(forward|aage)\b/i.test(lower)
              ? 'youtube_forward'
              : /\b(rewind|peeche)\b/i.test(lower)
                ? 'youtube_rewind'
                : /\b(speed up|tez)\b/i.test(lower)
                  ? 'youtube_speed_up'
                  : /\b(speed down|dheema|slow)\b/i.test(lower)
                    ? 'youtube_speed_down'
                    : 'youtube_prev';
    return runSlotTool('browser_control', { action: ytAction }, requestPermission, clean, `YouTube action: ${ytAction.replace('youtube_', '')}.`);
  }

  if (/\b(incognito|private window|reopen tab|closed tab|chrome downloads|browser downloads|chrome history|browser history|chrome bookmarks|zoom in|zoom out|zoom reset)\b/i.test(lower)) {
    const chAction = /\b(incognito|private window)\b/i.test(lower)
      ? 'new_incognito'
      : /\b(reopen|closed tab)\b/i.test(lower)
        ? 'reopen_tab'
        : /\bdownloads\b/i.test(lower)
          ? 'downloads'
          : /\bhistory\b/i.test(lower)
            ? 'history'
            : /\bbookmarks\b/i.test(lower)
              ? 'bookmarks'
              : /\bzoom in\b/i.test(lower)
                ? 'zoom_in'
                : /\bzoom out\b/i.test(lower)
                  ? 'zoom_out'
                  : 'zoom_reset';
    return runSlotTool('browser_control', { action: chAction }, requestPermission, clean, `Browser action: ${chAction}.`);
  }

  if (/\b(vs code|vscode)\b/i.test(lower) && /\b(command palette|terminal|sidebar|format|quick open|find file|run|debug|save all|close editor|folder)\b/i.test(lower)) {
    const combo = /\bcommand palette\b/i.test(lower)
      ? 'ctrl+shift+p'
      : /\bterminal\b/i.test(lower)
        ? 'ctrl+`'
        : /\bsidebar\b/i.test(lower)
          ? 'ctrl+b'
          : /\bformat\b/i.test(lower)
            ? 'shift+alt+f'
            : /\b(quick open|find file)\b/i.test(lower)
              ? 'ctrl+p'
              : /\b(run|debug)\b/i.test(lower)
                ? 'f5'
                : /\bsave all\b/i.test(lower)
                  ? 'ctrl+s'
                  : 'ctrl+w';
    await runSlotTool('control_app_window', { action: 'focus', app_name: 'code' }, requestPermission, clean, 'Focused VS Code');
    return runSlotTool('press_shortcut', { shortcut: combo }, requestPermission, clean, `Ran VS Code shortcut (${combo.toUpperCase()}).`);
  }

  if (/\b(github|git)\b/i.test(lower)) {
    if (/\b(pulls|pull requests|issues|notifications)\b/i.test(lower)) {
      const sub = /\bpulls|pull requests\b/i.test(lower) ? 'pulls' : /\bissues\b/i.test(lower) ? 'issues' : 'notifications';
      return runSlotTool('open_url', { url: `https://github.com/${sub}` }, requestPermission, clean, `Opened GitHub ${sub}.`);
    }
    const ghSearch = clean.match(/\bgithub\s+(?:par|on|repo|search)?\s*["']?([a-z0-9._/-]{2,40})["']?\s*(?:kholo|open|search|dikhao)?$/i);
    if (ghSearch?.[1] && !/\b(push|pull|commit|status|log)\b/i.test(ghSearch[1])) {
      const q = ghSearch[1].trim();
      const targetUrl = q.includes('/') ? `https://github.com/${q}` : `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`;
      return runSlotTool('open_url', { url: targetUrl }, requestPermission, clean, `Opened GitHub for ${q}.`);
    }
    if (/\bgit\s+status\b/i.test(lower)) {
      return runSlotTool('run_system_command', { command: 'git status -sb' }, requestPermission, clean, 'Checked git status.');
    }
    if (/\bgit\s+log\b/i.test(lower)) {
      return runSlotTool('run_system_command', { command: 'git log -n 8 --oneline' }, requestPermission, clean, 'Fetched recent git commits.');
    }
    if (/\bgit\s+pull\b/i.test(lower)) {
      return runSlotTool('run_system_command', { command: 'git pull' }, requestPermission, clean, 'Pulled latest git changes.');
    }
    if (/\b(git\s+push|github\s+(?:par|pe)\s+push)\b/i.test(lower)) {
      return runSlotTool('run_system_command', { command: 'git push' }, requestPermission, clean, 'Pushed commits to GitHub.');
    }
  }

  // 2. Folder Organization ("downloads organize karo", "desktop organize kar do")
  if (/\b(organize|arrange|sort|vyavasthit)\b/i.test(lower) && /\b(downloads?|desktop|documents?)\b/i.test(lower)) {
    const source = /\bdesktop\b/i.test(lower) ? 'desktop' : /\bdocuments?\b/i.test(lower) ? 'documents' : 'downloads';
    return runSlotTool(
      'file_manager_pro',
      { action: 'organize_folder', source },
      requestPermission,
      clean,
      replyByLang(lang, `Organized ${source} folder.`, `${source} folder organize kar diya hai.`, `${source} फ़ोल्डर व्यवस्थित कर दिया है।`)
    );
  }

  // 3. Local File Search ("downloads me resume dhundo", "search file invoice on desktop")
  const fileSearchMatch =
    clean.match(/\b(?:downloads?|desktop|documents?)\s+(?:mein|me|par|pe|in|on)\s+["']?(.{2,45}?)["']?\s+(?:file\s+)?(?:search|find|dhundo|khojo|nikaalo)\b/i) ||
    clean.match(/\b(?:search|find|dhundo|khojo)\s+(?:file\s+)?["']?(.{2,45}?)["']?\s+(?:in|on|mein|me|par|pe)\s+(downloads?|desktop|documents?)\b/i) ||
    clean.match(/^(?:search|find|dhundo)\s+file\s+["']?(.{2,45}?)["']?$/i);
  if (fileSearchMatch && fileSearchMatch[1]) {
    const rawQuery = fileSearchMatch[1].replace(/\b(file|karo|do)\b/gi, '').trim();
    const folder = /\bdesktop\b/i.test(lower) ? 'desktop' : /\bdocuments?\b/i.test(lower) ? 'documents' : 'downloads';
    if (rawQuery.length >= 2) {
      return runSlotTool(
        'file_operation',
        { operation: 'search', path: folder, query: rawQuery },
        requestPermission,
        clean,
        `Searched for "${rawQuery}" in ${folder}.`
      );
    }
  }

  // 4. Installed Software List & Winget Search/Install/Uninstall
  if (/\b(installed apps|installed software|installed programs|kaun se apps install)\b/i.test(lower)) {
    const filterMatch = clean.match(/\b(?:filter|search|like|for)\s+([a-z0-9._-]{2,24})/i);
    return runSlotTool(
      'list_installed_software',
      filterMatch ? { filter: filterMatch[1] } : {},
      requestPermission,
      clean,
      'Listed installed software.'
    );
  }
  const pkgMatch =
    clean.match(/^(?:install|uninstall|update|upgrade)\s+([a-z0-9][a-z0-9\s._-]{1,30}?)(?:\s+(?:karo|kar do|app|software))?$/i) ||
    clean.match(/^([a-z0-9][a-z0-9\s._-]{1,30}?)\s+(install|uninstall|update)(?:\s+(?:karo|kar do|kardo))?$/i);
  if (pkgMatch && /\b(install|uninstall|update)\b/i.test(lower)) {
    const action = /\buninstall\b/i.test(lower) ? 'uninstall' : /\bupdate\b/i.test(lower) ? 'update' : 'install';
    const pkg = (pkgMatch[1] && !/^(install|uninstall|update)$/i.test(pkgMatch[1]) ? pkgMatch[1] : pkgMatch[2] || '')
      .replace(/\b(install|uninstall|update|karo|do|app|software)\b/gi, '')
      .trim();
    if (pkg.length >= 2 && !/\b(windows|system|app|software)\b/i.test(pkg)) {
      return runSlotTool('manage_software', { action, package: pkg }, requestPermission, clean, `${action}: ${pkg}`);
    }
  }

  // 5. Windows Settings Pages ("bluetooth settings kholo", "display settings", "wifi settings")
  if (/\b(setting|settings)\b/i.test(lower) && /\b(open|kholo|launch|show|dikhao)\b/i.test(lower)) {
    let targetSetting = 'main';
    for (const [key, rx] of WINDOWS_SETTING_ALIASES) {
      if (rx.test(lower)) {
        targetSetting = key;
        break;
      }
    }
    return runSlotTool(
      'open_windows_setting',
      { setting: targetSetting },
      requestPermission,
      clean,
      replyByLang(lang, `Opened ${targetSetting} settings.`, `${targetSetting} settings khol di hain.`, `${targetSetting} सेटिंग्स खोल दी हैं।`)
    );
  }

  // 6. Running Apps & Window Snap / Maximize / Minimize / Focus
  if (/\b(running apps|open windows|kaun se apps khule|active apps)\b/i.test(lower)) {
    return runSlotTool('get_running_apps', {}, requestPermission, clean, 'Fetched running applications.');
  }
  const winCtrlMatch =
    clean.match(/\b(focus|maximize|minimize|restore|snap left|snap right)\s+(?:on\s+|window\s+)?([a-z0-9][a-z0-9\s._-]{1,24})$/i) ||
    clean.match(/^([a-z0-9][a-z0-9\s._-]{1,24}?)\s+(?:window\s+)?(maximize|minimize|focus|restore|snap left|snap right)(?:\s+karo)?$/i);
  if (winCtrlMatch && !/\b(all windows|sab minimize|minimize all)\b/i.test(lower)) {
    const rawAct = /\bmaximize\b/i.test(lower)
      ? 'maximize'
      : /\bminimize\b/i.test(lower)
        ? 'minimize'
        : /\brestore\b/i.test(lower)
          ? 'restore'
          : /\bsnap left\b/i.test(lower)
            ? 'snap_left'
            : /\bsnap right\b/i.test(lower)
              ? 'snap_right'
              : 'focus';
    const appCandidate = (winCtrlMatch[2] || winCtrlMatch[1] || '')
      .replace(/\b(focus|maximize|minimize|restore|snap|left|right|window|karo|do)\b/gi, '')
      .trim();
    if (appCandidate.length >= 2) {
      return runSlotTool(
        'control_app_window',
        { action: rawAct, app_name: appCandidate },
        requestPermission,
        clean,
        replyByLang(lang, `Updated ${appCandidate} window (${rawAct}).`, `${appCandidate} window ${rawAct} kar di hai.`, `${appCandidate} विंडो अपडेट कर दी है।`)
      );
    }
  }

  // 7. System Power Actions (Protected by Permission Guard confirmation)
  if (/^(?:please\s+)?(?:lock(?:\s+(?:pc|laptop|screen|computer))?|pc lock karo|screen lock karo|sleep(?:\s+(?:pc|laptop|computer))?|pc sleep|restart(?:\s+(?:pc|laptop|computer))?|pc restart|shutdown(?:\s+(?:pc|laptop|computer))?|pc shutdown|shut down(?:\s+(?:pc|laptop|computer))?)(?:\s+karo)?$/i.test(lower)) {
    const pAct = /\bshutdown|shut down\b/i.test(lower)
      ? 'shutdown'
      : /\brestart\b/i.test(lower)
        ? 'restart'
        : /\bsleep\b/i.test(lower)
          ? 'sleep'
          : 'lock';
    return runSlotTool('system_power', { action: pAct }, requestPermission, clean, `Power action: ${pAct}`);
  }

  return null;
}
