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
  const bajeMatch = lower.match(/\b(?:(subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night)\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:baje|baja|bje)(?:\s+(subah|shaam|sham|raat))?\b/i);
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
  if (!/\b(remind|reminder|yaad\s*(?:dilana|delana|dila|dilao|rakhna)|yad\s*(?:dilana|delana|dila|dilao|rakhna)|alarm|timer)\b/i.test(lower)) {
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
  } else if (/\b(?:(?:in|after)\s+)?(\d{1,3})\s*(?:din|days?|day)(?:\s*(?:baad|bad|later|ke\s+baad))?\b/i.test(lower) && /\b(baad|bad|later|after|in)\b/i.test(lower)) {
    const mDays = lower.match(/\b(?:(?:in|after)\s+)?(\d{1,3})\s*(?:din|days?|day)(?:\s*(?:baad|bad|later|ke\s+baad))?\b/i);
    const offset = Math.min(120, Math.max(1, Number(mDays?.[1] || 1)));
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  } else if (/\b(?:(?:in|after)\s+)?(\d{1,2})\s*(?:hafte|hafta|weeks?|week)(?:\s*(?:baad|bad|later|ke\s+baad))?\b/i.test(lower) && /\b(baad|bad|later|after|in)\b/i.test(lower)) {
    const mWeeks = lower.match(/\b(?:(?:in|after)\s+)?(\d{1,2})\s*(?:hafte|hafta|weeks?|week)(?:\s*(?:baad|bad|later|ke\s+baad))?\b/i);
    const offset = Math.min(120, Math.max(1, Number(mWeeks?.[1] || 1) * 7));
    targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  } else if (/\b(?:(?:in|after)\s+)?(\d{1,2})\s*(?:mahine|mahina|months?|month)(?:\s*(?:baad|bad|later|ke\s+baad))?\b/i.test(lower) && /\b(baad|bad|later|after|in)\b/i.test(lower)) {
    const mMonths = lower.match(/\b(?:(?:in|after)\s+)?(\d{1,2})\s*(?:mahine|mahina|months?|month)(?:\s*(?:baad|bad|later|ke\s+baad))?\b/i);
    const offset = Math.min(4, Math.max(1, Number(mMonths?.[1] || 1)));
    targetDate = new Date(now.getFullYear(), now.getMonth() + offset, now.getDate());
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
    .replace(/\b(?:(?:in|after)\s+)?\d{1,3}\s*(?:din|days?|day|hafte|hafta|weeks?|week|mahine|mahina|months?|month)(?:\s*(?:ke\s+)?(?:baad|bad|later))?\b/gi, ' ')
    .replace(/\b(\d{4}-\d{2}-\d{2}|aaj|ajj|today|kal|tomorrow|parso|day after tomorrow)\b/gi, ' ')
    .replace(/\b(?:subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|baje|baja|bje)(?:\s+(?:subah|shaam|sham|raat))?\b/gi, ' ')
    .replace(/\b(remind me|reminder|yaad\s*(?:dilana|delana|dila\s+dena|dila|dilao|rakhna)|yad\s*(?:dilana|delana|dila\s+dena|dila|dilao|rakhna)|lagao|set karo|rakhna|bata dena|ki|ke|ko|ka|hai|hamko|mujhe|karna|at|to)\b/gi, ' ')
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

let _currentSlotFromVoice = false;

async function runSlotTool(toolName, args, requestPermission, cleanText, fallbackSuccess) {
  const res = await executeFunctionCall(toolName, args, requestPermission, {
    fromVoice: _currentSlotFromVoice,
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
export async function tryLocalSlotAction(cleanText, lang = 'hinglish', requestPermission = null, opts = {}) {
  if (lang && typeof lang === 'object') {
    opts = lang;
    requestPermission = lang.requestPermission || requestPermission;
    lang = lang.lang || 'hinglish';
  }
  _currentSlotFromVoice = Boolean(opts?.fromVoice);
  const clean = String(cleanText || '').trim();
  const lower = clean.toLowerCase();
  if (!clean) return null;

  // 0A. Voice Routines / Multi-Step Agent Modes ("Study mode", "Work mode", "Good morning", "Good night", "Chill mode")
  if (/\b(study mode|focus mode|padhai mode)\b/i.test(lower) && !/\b(off|band|stop)\b/i.test(lower)) {
    await runSlotTool('control_volume', { action: 'set', level: 25 }, requestPermission, clean, 'Volume 25%');
    await runSlotTool('schedule_pc_task', { action: 'remind', delay_minutes: 45, message: 'Study focus session complete — take a 5 minute break!' }, requestPermission, clean, '45m timer');
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Agent Routine',
      routeReason: 'Executed Study/Focus routine locally',
      replyText: replyByLang(
        lang,
        'Study Mode activated: volume set to 25% and a 45-minute focus timer is running.',
        'Study Mode on kar diya: volume 25% set hai aur 45 minute ka focus timer lag gaya hai.',
        'स्टडी मोड चालू कर दिया: वॉल्यूम 25% और 45 मिनट का फ़ोकस टाइमर लग गया है।'
      ),
      tools: [
        { name: 'control_volume', status: 'done', args: { action: 'set', level: 25 } },
        { name: 'schedule_pc_task', status: 'done', args: { action: 'remind', delay_minutes: 45 } },
      ],
    };
  }
  if (/\b(work mode|coding mode|dev mode|office mode)\b/i.test(lower) && !/\b(off|band|stop)\b/i.test(lower)) {
    await runSlotTool('open_application', { app_name: 'code' }, requestPermission, clean, 'Opened VS Code');
    await runSlotTool('open_application', { app_name: 'chrome' }, requestPermission, clean, 'Opened Chrome');
    await runSlotTool('control_volume', { action: 'set', level: 40 }, requestPermission, clean, 'Volume 40%');
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Agent Routine',
      routeReason: 'Executed Work/Coding routine locally',
      replyText: replyByLang(
        lang,
        'Work Mode activated: VS Code and Chrome opened, volume set to 40%.',
        'Work Mode on kar diya: VS Code aur Chrome khol diye hain, volume 40% set hai.',
        'वर्क मोड चालू कर दिया: VS Code और Chrome खोल दिए हैं, वॉल्यूम 40% सेट है।'
      ),
      tools: [
        { name: 'open_application', status: 'done', args: { app_name: 'code' } },
        { name: 'open_application', status: 'done', args: { app_name: 'chrome' } },
      ],
    };
  }
  if (/\b(good morning|morning briefing|subah ka briefing|daily briefing)\b/i.test(lower)) {
    const agRes = await executeFunctionCall('schedule_pc_task', { action: 'agenda' }, requestPermission, { fromVoice: false, originalQuery: clean });
    const batRes = await executeFunctionCall('get_battery_status', {}, requestPermission, { fromVoice: false, originalQuery: clean });
    const ag = agRes?.result && typeof agRes.result === 'object' ? agRes.result : {};
    const todayCount = Array.isArray(ag.todayItems) ? ag.todayItems.length : 0;
    const missedCount = Array.isArray(ag.missedItems) ? ag.missedItems.length : 0;
    const batStr = typeof batRes?.result === 'string' ? batRes.result : '';
    const summary = replyByLang(
      lang,
      `Good morning! You have ${todayCount} reminder(s) today${missedCount ? ` and ${missedCount} missed` : ''}.${batStr ? ' ' + batStr : ''}`,
      `Good morning! Aaj aapke ${todayCount} reminders hain${missedCount ? ` aur ${missedCount} missed reminders hain` : ''}.${batStr ? ' ' + batStr : ''}`,
      `सुप्रभात! आज आपके ${todayCount} रिमाइंडर हैं।${batStr ? ' ' + batStr : ''}`
    );
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Daily Briefing',
      routeReason: 'Executed morning briefing locally',
      replyText: summary,
      tools: [{ name: 'schedule_pc_task', status: 'done', args: { action: 'agenda' } }],
    };
  }
  if (/\b(good night|night mode|chill mode|relax mode)\b/i.test(lower) && !/\b(windows|theme)\b/i.test(lower)) {
    if (/\b(chill|relax)\b/i.test(lower)) {
      await runSlotTool('control_volume', { action: 'set', level: 70 }, requestPermission, clean, 'Volume 70%');
      await runSlotTool('open_url', { url: 'https://www.youtube.com' }, requestPermission, clean, 'Opened YouTube');
      return {
        handled: true,
        tier: 'fast',
        modelLabel: 'Agent Routine',
        routeReason: 'Executed Chill routine locally',
        replyText: replyByLang(lang, 'Chill Mode on: volume set to 70% and YouTube opened.', 'Chill Mode on: volume 70% set hai aur YouTube khol diya hai.', 'चिल मोड चालू: वॉल्यूम 70% और YouTube खोल दिया है।'),
        tools: [{ name: 'open_url', status: 'done', args: { url: 'https://www.youtube.com' } }],
      };
    }
    await runSlotTool('control_volume', { action: 'mute' }, requestPermission, clean, 'Muted');
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Agent Routine',
      routeReason: 'Executed Night routine locally',
      replyText: replyByLang(lang, 'Good night! Audio muted and JEEVA is on standby.', 'Good night! Audio mute kar diya hai aur JEEVA standby par hai.', 'शुभ रात्रि! ऑडियो म्यूट कर दिया है।'),
      tools: [{ name: 'control_volume', status: 'done', args: { action: 'mute' } }],
    };
  }

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
  if (/\b(aaj ka agenda|missed reminders|kya yaad dilana|active reminders|list reminders|show reminders|my reminders|what are my reminders|show my agenda|today's agenda|reminders dikhao|scheduled tasks|meri timers)\b/i.test(lower)) {
    const rawRes = await executeFunctionCall(
      'schedule_pc_task',
      { action: 'agenda' },
      requestPermission,
      { fromVoice: false, userPrompt: clean }
    );
    const ok = !rawRes?.error;
    let replyText = '';
    if (!ok) {
      replyText = String(rawRes.error);
    } else if (typeof rawRes?.result === 'string' && rawRes.result.trim()) {
      replyText = rawRes.result.trim();
    } else if (rawRes?.result && typeof rawRes.result === 'object') {
      const todayItems = Array.isArray(rawRes.result.todayItems) ? rawRes.result.todayItems : [];
      const missedItems = Array.isArray(rawRes.result.missedItems) ? rawRes.result.missedItems : [];
      const upcomingItems = Array.isArray(rawRes.result.upcomingItems) ? rawRes.result.upcomingItems : [];
      const sections = [];
      if (todayItems.length > 0) {
        sections.push(
          `Today (${todayItems.length}):\n` +
            todayItems.map((it) => `• ${it.timeLabel || 'Today'}: ${it.message || 'Reminder'}`).join('\n')
        );
      }
      if (missedItems.length > 0) {
        sections.push(
          `Missed (${missedItems.length}):\n` +
            missedItems.map((it) => `• ${it.dateKey || ''} ${it.timeLabel || ''}: ${it.message || 'Reminder'}`.trim()).join('\n')
        );
      }
      if (upcomingItems.length > 0) {
        sections.push(
          `Upcoming (${upcomingItems.length}):\n` +
            upcomingItems.map((it) => `• ${it.dateKey || ''} ${it.timeLabel || ''}: ${it.message || 'Reminder'}`.trim()).join('\n')
        );
      }
      replyText = sections.length > 0
        ? sections.join('\n\n')
        : replyByLang(
            lang,
            'You have no active or missed reminders.',
            'Koi active ya missed reminder nahi hai.',
            'कोई सक्रिय या छूटा हुआ रिमाइंडर नहीं है।'
          );
    } else {
      replyText = replyByLang(
        lang,
        'You have no active or missed reminders.',
        'Koi active ya missed reminder nahi hai.',
        'कोई सक्रिय या छूटा हुआ रिमाइंडर नहीं है।'
      );
    }
    return {
      handled: true,
      tier: 'fast',
      modelLabel: 'Local Command Engine',
      routeReason: 'Executed parameterized PC command locally (0 Gemini API calls)',
      replyText,
      tools: [{ name: 'schedule_pc_task', status: ok ? 'done' : 'error', args: { action: 'agenda' } }],
    };
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
    if (res.tools?.[0]?.status === 'error') return res;
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
    clean.match(/(\d+(?:\.\d+)?)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|ghanta|ghante|मिनट|सेकंड|घंटे)\b[\s\S]*?\b(?:baad|bad|after|later|ka|for|to)?\s*(?:reminder|timer|alarm|yaad|yad)?[:\s-]*(.*)$/i) ||
    clean.match(/\b(?:remind\s+me|set\s+(?:a\s+)?(?:reminder|timer|alarm))\s+(?:in|after|for)\s+(\d+(?:\.\d+)?)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)(?:\s+from\s+now)?\s*(?:to|about|for)?\s*(.*)$/i);
  if (timerMatch && /\b(remind|reminder|timer|alarm|yaad|yad)\b/i.test(lower)) {
    const rawVal = Number(timerMatch[1]) || 5;
    const unit = String(timerMatch[2] || 'min').toLowerCase();
    const mins = /^(sec|second|सेकंड)/.test(unit)
      ? Math.max(0.05, Number((rawVal / 60).toFixed(2)))
      : /^(hr|hour|ghant|घंट)/.test(unit)
        ? Math.min(72 * 60, rawVal * 60)
        : Math.max(0.1, rawVal);
    timerMatch[2] = timerMatch[3] || '';
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
  if (/\b(installed apps|installed software|installed programs|what apps are installed|kaun se apps install)\b/i.test(lower)) {
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
    clean.match(/^(?:please\s+)?(?:install|uninstall|remove|update|upgrade)\s+(?:app\s+|software\s+)?([a-z0-9][a-z0-9\s._+-]{1,34}?)(?:\s+(?:ko\s+)?(?:karo|kar do|kardo|app|software))?$/i) ||
    clean.match(/^(?:please\s+)?([a-z0-9][a-z0-9\s._+-]{1,34}?)(?:\s+(?:app|software))?(?:\s+ko)?\s+(install|uninstall|remove|hatao|hata do|update|upgrade)(?:\s+(?:karo|kar do|kardo|de|do))?$/i);
  if (pkgMatch && /\b(install|uninstall|remove|hatao|hata do|update|upgrade)\b/i.test(lower)) {
    const action = /\b(uninstall|remove|hatao|hata do)\b/i.test(lower)
      ? 'uninstall'
      : /\b(update|upgrade)\b/i.test(lower)
        ? 'update'
        : 'install';
    const pkg = (pkgMatch[1] && !/^(install|uninstall|remove|hatao|hata do|update|upgrade)$/i.test(pkgMatch[1]) ? pkgMatch[1] : pkgMatch[2] || '')
      .replace(/\b(install|uninstall|remove|hatao|hata|update|upgrade|karo|kar|kardo|do|de|ko|app|software|please)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (pkg.length >= 2 && !/\b(windows|system|app|software|file|folder)\b/i.test(pkg)) {
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
  // Close active/current window ("window band karo", "ye window band kar do", "close window")
  if (/^(?:please\s+)?(?:(?:ye|yeh|is|current|active)\s+)?(?:window|app|screen)\s+(?:band|close)(?:\s+(?:karo|kar do|kardo))?$/i.test(lower) || /^(?:close|band)\s+(?:this\s+|current\s+|active\s+)?window(?:\s+(?:karo|kar do))?$/i.test(lower)) {
    return runSlotTool(
      'press_shortcut',
      { shortcut: 'alt+f4' },
      requestPermission,
      clean,
      replyByLang(lang, 'Closed the active window.', 'Active window band kar di hai.', 'सक्रिय विंडो बंद कर दी है।')
    );
  }

  // App-first match MUST run before verb-first so "chrome minimize kar do" captures "chrome", NOT "kar"
  const winVerbPattern = '(?:maximize|minimize|focus|switch to|bring|restore|snap left|snap right|chota|chhota|bada|badaa|niche|samne)';
  const winAppFirst = clean.match(
    new RegExp(`^(?:please\\s+)?([a-z0-9][a-z0-9\\s._+-]{1,28}?)(?:\\s+(?:window|app|ko))?\\s+${winVerbPattern}(?:\\s+(?:karo|kar do|kardo|kar|do|de|laao))?$`, 'i')
  );
  const winVerbFirst = !winAppFirst
    ? clean.match(
        new RegExp(`^(?:please\\s+)?${winVerbPattern}\\s+(?:on\\s+|window\\s+|app\\s+)?([a-z0-9][a-z0-9\\s._+-]{1,28}?)(?:\\s+(?:window|app|karo|kar do|kardo))?$`, 'i')
      )
    : null;
  const winRawTarget = winAppFirst ? winAppFirst[1] : winVerbFirst ? winVerbFirst[1] : '';
  if (winRawTarget && !/\b(all windows|sab|minimize all|sabhi)\b/i.test(lower)) {
    const rawAct = /\b(maximize|bada|badaa)\b/i.test(lower)
      ? 'maximize'
      : /\b(minimize|chota|chhota|niche)\b/i.test(lower)
        ? 'minimize'
        : /\brestore\b/i.test(lower)
          ? 'restore'
          : /\bsnap left\b/i.test(lower)
            ? 'snap_left'
            : /\bsnap right\b/i.test(lower)
              ? 'snap_right'
              : 'focus';
    const appCandidate = winRawTarget
      .replace(/\b(focus|maximize|minimize|restore|snap|left|right|chota|chhota|bada|badaa|niche|samne|window|app|software|karo|kar|kardo|do|de|ko|please)\b/gi, '')
      .replace(/\s+/g, ' ')
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

  // 6.5 Max-Level Productivity Shortcuts, Scroll, Clipboard, Notes, Folders, Cleanup, Diagnostics & Web Search
  // A. Instant Keyboard Shortcuts ("copy karo", "paste karo", "undo karo", "alt tab", "task manager kholo", "new tab", "close tab")
  const SHORTCUT_RULES = [
    [/^(?:please\s+)?(?:copy|copy karo|copy kar do)$/i, 'ctrl+c', 'Copied selection.'],
    [/^(?:please\s+)?(?:paste|paste karo|paste kar do)$/i, 'ctrl+v', 'Pasted from clipboard.'],
    [/^(?:please\s+)?(?:cut|cut karo|cut kar do)$/i, 'ctrl+x', 'Cut selection.'],
    [/^(?:please\s+)?(?:undo|undo karo|wapas karo)$/i, 'ctrl+z', 'Undid last action.'],
    [/^(?:please\s+)?(?:redo|redo karo)$/i, 'ctrl+y', 'Redid action.'],
    [/^(?:please\s+)?(?:select all|sab select karo|sab select kar do)$/i, 'ctrl+a', 'Selected all.'],
    [/^(?:please\s+)?(?:save|save karo|file save karo|save kar do)$/i, 'ctrl+s', 'Saved current file.'],
    [/^(?:please\s+)?(?:print|print karo|print kar do)$/i, 'ctrl+p', 'Opened print dialog.'],
    [/^(?:please\s+)?(?:refresh|refresh karo|reload|reload karo)$/i, 'f5', 'Refreshed active window.'],
    [/^(?:please\s+)?(?:alt tab|switch window|dusra window|next window|window badlo)$/i, 'alt+tab', 'Switched window.'],
    [/^(?:please\s+)?(?:task manager|task manager kholo|open task manager)$/i, 'ctrl+shift+esc', 'Opened Task Manager.'],
    [/^(?:please\s+)?(?:new tab|new tab kholo|naya tab|naya tab kholo|open new tab)$/i, 'ctrl+t', 'Opened a new tab.'],
    [/^(?:please\s+)?(?:close tab|tab band karo|ye tab band karo|current tab close)$/i, 'ctrl+w', 'Closed current tab.'],
    [/^(?:please\s+)?(?:next tab|agla tab)$/i, 'ctrl+tab', 'Switched to next tab.'],
    [/^(?:please\s+)?(?:previous tab|pichla tab)$/i, 'ctrl+shift+tab', 'Switched to previous tab.'],
  ];
  for (const [rx, combo, msg] of SHORTCUT_RULES) {
    if (rx.test(lower)) {
      return runSlotTool('press_shortcut', { shortcut: combo }, requestPermission, clean, msg);
    }
  }

  // B. Scroll & Mouse Clicks ("niche scroll karo", "scroll down", "upar scroll karo", "double click", "right click")
  if (/^(?:please\s+)?(?:scroll\s+down|niche\s+scroll(?:\s+karo|\s+kar\s+do)?|page\s+down)$/i.test(lower)) {
    return runSlotTool('mouse_and_hotkey', { action: 'scroll', direction: 'down', amount: 5 }, requestPermission, clean, 'Scrolled down.');
  }
  if (/^(?:please\s+)?(?:scroll\s+up|upar\s+scroll(?:\s+karo|\s+kar\s+do)?|page\s+up)$/i.test(lower)) {
    return runSlotTool('mouse_and_hotkey', { action: 'scroll', direction: 'up', amount: 5 }, requestPermission, clean, 'Scrolled up.');
  }
  if (/^(?:please\s+)?(?:double\s+click(?:\s+karo)?|right\s+click(?:\s+karo)?)$/i.test(lower)) {
    const mAct = /right/i.test(lower) ? 'right_click' : 'double_click';
    return runSlotTool('mouse_and_hotkey', { action: mAct }, requestPermission, clean, `Performed ${mAct.replace('_', ' ')}.`);
  }

  // C. Clipboard History & Clear ("clipboard dikhao", "maine kya copy kiya tha", "clipboard clear karo")
  if (/\b(clipboard|copy history|kya copy kiya)\b/i.test(lower) && !/\b(type|likho)\b/i.test(lower)) {
    if (/\b(clear|saaf|delete|khali|empty)\b/i.test(lower)) {
      return runSlotTool('clipboard_history', { action: 'clear' }, requestPermission, clean, replyByLang(lang, 'Clipboard history cleared.', 'Clipboard history saaf kar di hai.', 'क्लिपबोर्ड हिस्ट्री साफ़ कर दी है।'));
    }
    return runSlotTool('clipboard_history', { action: 'list' }, requestPermission, clean, replyByLang(lang, 'Fetched clipboard history.', 'Clipboard history nikal li hai.', 'क्लिपबोर्ड हिस्ट्री मिल गई है।'));
  }

  // D. Quick Desktop Note ("note banao ...", "desktop par note save karo ...")
  const noteMatch =
    clean.match(/^(?:please\s+)?(?:desktop\s+(?:par|pe|on)\s+)?(?:quick\s+)?note\s+(?:banao|save\s+karo|likho|create|save)[:\s-]+(.{3,500})$/i) ||
    clean.match(/^(?:please\s+)?(?:save\s+(?:a\s+)?note)[:\s-]+(.{3,500})$/i);
  if (noteMatch?.[1]) {
    const content = noteMatch[1].trim();
    const stamp = new Date().toISOString().slice(0, 10);
    return runSlotTool(
      'save_desktop_note',
      { filename: `jeeva-note-${stamp}.txt`, content },
      requestPermission,
      clean,
      replyByLang(lang, `Saved note to Desktop: "${content.slice(0, 60)}"`, `Desktop par note save kar diya: "${content.slice(0, 60)}"`, `डेस्कटॉप पर नोट सेव कर दिया: "${content.slice(0, 60)}"`)
    );
  }

  // E. Create Folder ("desktop par Projects folder banao", "create folder Work on downloads")
  const mkdirMatch =
    clean.match(/\b(desktop|downloads?|documents?)\s+(?:par|pe|mein|me|in|on)\s+["']?([a-z0-9][a-z0-9\s._-]{1,30}?)["']?\s+folder\s+(?:banao|create|bana\s+do)\b/i) ||
    clean.match(/\b(?:create|make|banao)\s+(?:a\s+)?folder\s+(?:called\s+|named\s+)?["']?([a-z0-9][a-z0-9\s._-]{1,30}?)["']?\s+(?:on|in|par|pe|mein|me)\s+(desktop|downloads?|documents?)\b/i);
  if (mkdirMatch) {
    const isFirstFolder = /^(desktop|downloads?|documents?)$/i.test(mkdirMatch[1]);
    const base = (isFirstFolder ? mkdirMatch[1] : mkdirMatch[2]).toLowerCase().replace(/s$/, '') === 'desktop' ? 'desktop' : /doc/i.test(isFirstFolder ? mkdirMatch[1] : mkdirMatch[2]) ? 'documents' : 'downloads';
    const folderName = (isFirstFolder ? mkdirMatch[2] : mkdirMatch[1]).trim();
    if (folderName.length >= 1) {
      return runSlotTool(
        'file_manager_pro',
        { action: 'mkdir', source: `${base}\\${folderName}` },
        requestPermission,
        clean,
        replyByLang(lang, `Created folder "${folderName}" in ${base}.`, `${base} me "${folderName}" folder bana diya hai.`, `${base} में "${folderName}" फ़ोल्डर बना दिया है।`)
      );
    }
  }

  // F. PC Cleanup & Diagnostics ("recycle bin khali karo", "temp clean karo", "top processes dikhao", "disk space check", "open ports")
  if (/\b(recycle bin|trash)\b/i.test(lower) && /\b(empty|khali|clean|saaf|clear)\b/i.test(lower)) {
    return runSlotTool('pc_power_tools', { action: 'empty_recycle_bin' }, requestPermission, clean, replyByLang(lang, 'Recycle Bin emptied.', 'Recycle Bin khali kar diya hai.', 'रीसाइकल बिन खाली कर दिया है।'));
  }
  if (/\b(temp|temporary|junk|kachra|cache)\b/i.test(lower) && /\b(clean|saaf|clear|delete|remove|hatao)\b/i.test(lower)) {
    return runSlotTool('pc_power_tools', { action: 'clean_temp' }, requestPermission, clean, replyByLang(lang, 'Temporary junk files cleaned.', 'Temp junk files saaf kar di hain.', 'टेम्प जंक फ़ाइलें साफ़ कर दी हैं।'));
  }
  if (/\b(top processes|heavy apps|zyada ram|high cpu|kaun sa app.*ram|kaun sa app.*cpu)\b/i.test(lower)) {
    return runSlotTool('system_diagnostics', { action: 'top_processes' }, requestPermission, clean, 'Fetched top resource-using apps.');
  }
  if (/\b(disk space|storage kitna|kitna storage|drive space|free space)\b/i.test(lower)) {
    return runSlotTool('system_diagnostics', { action: 'disk_space' }, requestPermission, clean, 'Checked disk space.');
  }
  if (/\b(open ports|listening ports|active ports)\b/i.test(lower)) {
    return runSlotTool('system_diagnostics', { action: 'ports' }, requestPermission, clean, 'Checked open network ports.');
  }

  // G. Screen Reader & Screenshot ("screen padho", "screen par kya hai", "screenshot lo")
  if (/\b(screen padh|screen read|read screen|read my screen|what is on my screen|screen par kya|buttons batao)\b/i.test(lower)) {
    return runSlotTool('screen_reader', { mode: 'summary' }, requestPermission, clean, 'Read active screen.');
  }
  if (/^(?:please\s+)?(?:take\s+(?:a\s+)?)?(?:screenshot|screen\s+capture)(?:\s+(?:lo|le\s+lo|karo|now))?$/i.test(lower)) {
    return runSlotTool('take_screenshot', {}, requestPermission, clean, replyByLang(lang, 'Screenshot captured.', 'Screenshot le liya hai.', 'स्क्रीनशॉट ले लिया है।'));
  }

  // G.5 Direct Website Opener in Chrome or Default Browser ("chrome me webbuildix.online kholo", "open github in chrome", "flipkart.com open karo")
  if (/\b(open|kholo|khol|chala|chalao|launch|go to|visit|jao)\b/i.test(lower) && !/\b(search|dhundo|khojo|google par|on google|play|bajao)\b/i.test(lower)) {
    const POPULAR_SITES = {
      youtube: 'https://www.youtube.com',
      gmail: 'https://mail.google.com',
      github: 'https://github.com',
      whatsapp: 'https://web.whatsapp.com',
      instagram: 'https://www.instagram.com',
      facebook: 'https://www.facebook.com',
      twitter: 'https://x.com',
      x: 'https://x.com',
      linkedin: 'https://www.linkedin.com',
      chatgpt: 'https://chatgpt.com',
      netflix: 'https://www.netflix.com',
      amazon: 'https://www.amazon.in',
      flipkart: 'https://www.flipkart.com',
      google: 'https://www.google.com',
      maps: 'https://maps.google.com',
      drive: 'https://drive.google.com',
      spotify: 'https://open.spotify.com',
      reddit: 'https://www.reddit.com',
      wikipedia: 'https://www.wikipedia.org',
      canva: 'https://www.canva.com',
      vercel: 'https://vercel.com',
      render: 'https://render.com',
    };
    const wantsChrome = /\bchrome\b/i.test(lower);
    const urlMatch = clean.match(/https?:\/\/[^\s"']+/i);
    const domainMatch = !urlMatch
      ? clean.match(/\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|in|org|net|io|ai|online|app|dev|co|edu|gov|me|xyz|tech|site|store|tv|gg)(?:\/[^\s"']*)?)\b/i)
      : null;

    let targetUrl = '';
    let siteLabel = '';
    if (urlMatch) {
      targetUrl = urlMatch[0];
      siteLabel = targetUrl;
    } else if (domainMatch) {
      targetUrl = `https://${domainMatch[1]}`;
      siteLabel = domainMatch[1];
    } else if (wantsChrome || /\b(website|site|web)\b/i.test(lower)) {
      const siteWords = Object.keys(POPULAR_SITES);
      const foundSite = siteWords.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(lower));
      if (foundSite) {
        targetUrl = POPULAR_SITES[foundSite];
        siteLabel = foundSite;
      }
    }

    if (targetUrl) {
      if (wantsChrome) {
        return runSlotTool(
          'open_application',
          { app_name: 'chrome', args: targetUrl },
          requestPermission,
          clean,
          replyByLang(lang, `Opened ${siteLabel} in Chrome.`, `Chrome me ${siteLabel} khol diya hai.`, `Chrome में ${siteLabel} खोल दिया है।`)
        );
      }
      return runSlotTool(
        'open_url',
        { url: targetUrl },
        requestPermission,
        clean,
        replyByLang(lang, `Opened ${siteLabel}.`, `${siteLabel} website khol di hai.`, `${siteLabel} वेबसाइट खोल दी है।`)
      );
    }
  }

  // H. Direct Google Web Search ("google par react hooks search karo", "search weather on google")
  const googleMatch =
    clean.match(/^(?:please\s+)?google\s+(?:par|pe|mein|me|on)?\s+(.{2,120}?)\s+(?:search|dhundo|khojo)(?:\s+(?:karo|kar\s+do))?$/i) ||
    clean.match(/^(?:please\s+)?(?:search|google)\s+(.{2,120}?)(?:\s+(?:on\s+google|google\s+par|google\s+pe))?(?:\s+(?:karo|kar\s+do))?$/i);
  if (googleMatch?.[1] && /\b(google|search)\b/i.test(lower) && !/\b(file|folder|downloads?|desktop|documents?|installed|memory|reminder)\b/i.test(lower)) {
    const q = googleMatch[1].replace(/\b(on google|google par|google pe|karo|kar do)\b/gi, '').trim();
    if (q.length >= 2) {
      return runSlotTool('search_web', { query: q }, requestPermission, clean, replyByLang(lang, `Searched Google for "${q}".`, `Google par "${q}" search kar diya hai.`, `Google पर "${q}" सर्च कर दिया है।`));
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
