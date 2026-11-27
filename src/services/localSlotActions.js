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

  // 1. Reminders & Timers ("10 minute baad meeting reminder", "remind me in 5 min to stretch", "reminders dikhao")
  if (/\b(active reminders|list reminders|reminders dikhao|scheduled tasks|meri timers)\b/i.test(lower)) {
    return runSlotTool('schedule_pc_task', { action: 'list' }, requestPermission, clean, 'Active reminders loaded.');
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
