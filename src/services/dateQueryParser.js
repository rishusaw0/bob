// Bilingual English + Hinglish + Hindi Natural Date & Episodic Query Parser (Zero-API)

const MONTHS = {
  jan: 0, january: 0, janwari: 0,
  feb: 1, february: 1, farwari: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4, mai: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, sitambar: 8,
  oct: 9, october: 9, aktubar: 9,
  nov: 10, november: 10, navambar: 10,
  dec: 11, december: 11, disambar: 11,
};

const WEEKDAY_MAP = {
  sunday: 0, sun: 0, ravivar: 0, itwar: 0, itwaar: 0,
  monday: 1, mon: 1, somwar: 1, somvar: 1,
  tuesday: 2, tue: 2, tues: 2, mangalwar: 2, mangalvar: 2,
  wednesday: 3, wed: 3, budhwar: 3, budhvar: 3,
  thursday: 4, thu: 4, thurs: 4, guruwar: 4, guruvar: 4, brihaspatiwar: 4,
  friday: 5, fri: 5, shukrawar: 5, shukravar: 5,
  saturday: 6, sat: 6, shaniwar: 6, shanivar: 6,
};

export function toDateKey(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isEpisodicHistoryQuery(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 220) return false;
  const lower = raw.toLowerCase();
  if (/\b(remind|reminder|yaad dilana|yaad dila|yaad dilao|yaad rakhna|alarm|timer)\b/i.test(lower)) {
    return false;
  }

  const hasPastRecallPhrase =
    /\b(kya pucha|kya bola|kya kaha|kya baat|kya kaam|kya command|kya jawaab|kya jawab|pucha tha|bola tha|kaha tha|diya tha|kiya tha|baat hui|what did i ask|what did i say|what did we talk|what did we discuss|what did you answer|what happened on|history of|maine kab|kab pucha|kab bola)\b|क्या पूछा|क्या बोला|क्या बात|कब पूछा/i.test(
      lower
    );

  const hasDateRef =
    /\b(aaj|today|kal|yesterday|parso|subah|morning|dopahar|afternoon|shaam|evening|raat|night|is hafte|this week|pichle|last week|days ago|din pehle|din pahle)\b/i.test(
      lower
    ) ||
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|ravivar|somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar)\b/i.test(
      lower
    ) ||
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(lower) ||
    /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/.test(lower);

  return hasPastRecallPhrase || (hasDateRef && /\b(yaad|history|timeline|log|record|memories|pucha|bola)\b/i.test(lower));
}

export function parseEpisodicDateQuery(text, now = new Date()) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let dateKey = '';
  let dateFrom = '';
  let dateTo = '';
  let weekday = '';
  let timeOfDay = '';
  let matchedLabel = '';

  // Time of day filter
  if (/\b(subah|morning|savere)\b|सुबह/i.test(lower)) timeOfDay = 'morning';
  else if (/\b(dopahar|afternoon)\b|दोपहर/i.test(lower)) timeOfDay = 'afternoon';
  else if (/\b(shaam|sham|evening)\b|शाम/i.test(lower)) timeOfDay = 'evening';
  else if (/\b(raat|night|midnight)\b|रात/i.test(lower)) timeOfDay = 'night';

  // 1. Explicit ISO date YYYY-MM-DD
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  // 2. Day + Month name (e.g. "25 november", "25 nov") or Month + Day ("november 25")
  const dmMatch = lower.match(/\b(\d{1,2})\s+(jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|mai|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*)\b/i);
  const mdMatch = lower.match(/\b(jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|mai|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*)\s+(\d{1,2})\b/i);
  // 3. DD/MM or DD-MM
  const slashMatch = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  // 4. Last N days
  const daysAgoMatch = lower.match(/\b(?:pichle|last|past)\s+(\d{1,2})\s+(?:din|days?)\b/i);
  const nDaysBackMatch = lower.match(/\b(\d{1,2})\s+(?:din\s+(?:pehle|pahle)|days?\s+ago)\b/i);

  if (isoMatch) {
    dateKey = isoMatch[0];
    matchedLabel = dateKey;
  } else if (dmMatch && MONTHS[dmMatch[2]] !== undefined) {
    const d = new Date(ref.getFullYear(), MONTHS[dmMatch[2]], Number(dmMatch[1]));
    if (d > ref) d.setFullYear(d.getFullYear() - 1);
    dateKey = toDateKey(d);
    matchedLabel = dmMatch[0];
  } else if (mdMatch && MONTHS[mdMatch[1]] !== undefined) {
    const d = new Date(ref.getFullYear(), MONTHS[mdMatch[1]], Number(mdMatch[2]));
    if (d > ref) d.setFullYear(d.getFullYear() - 1);
    dateKey = toDateKey(d);
    matchedLabel = mdMatch[0];
  } else if (slashMatch) {
    const yr = slashMatch[3]
      ? slashMatch[3].length === 2
        ? 2000 + Number(slashMatch[3])
        : Number(slashMatch[3])
      : ref.getFullYear();
    const d = new Date(yr, Number(slashMatch[2]) - 1, Number(slashMatch[1]));
    if (!slashMatch[3] && d > ref) d.setFullYear(d.getFullYear() - 1);
    dateKey = toDateKey(d);
    matchedLabel = slashMatch[0];
  } else if (nDaysBackMatch) {
    const d = new Date(ref);
    d.setDate(d.getDate() - Number(nDaysBackMatch[1]));
    dateKey = toDateKey(d);
    matchedLabel = nDaysBackMatch[0];
  } else if (daysAgoMatch) {
    const d = new Date(ref);
    d.setDate(d.getDate() - Math.max(1, Number(daysAgoMatch[1]) - 1));
    dateFrom = toDateKey(d);
    dateTo = toDateKey(ref);
    matchedLabel = `Last ${daysAgoMatch[1]} days`;
  } else if (/\b(parso|day before yesterday)\b|परसों/i.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() - 2);
    dateKey = toDateKey(d);
    matchedLabel = 'Parso (2 days ago)';
  } else if (/\b(kal|yesterday)\b|कल/i.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() - 1);
    dateKey = toDateKey(d);
    matchedLabel = 'Yesterday';
  } else if (/\b(aaj|today)\b|आज/i.test(lower)) {
    dateKey = toDateKey(ref);
    matchedLabel = 'Today';
  } else if (/\b(pichle hafte|last week)\b/i.test(lower)) {
    const end = new Date(ref);
    const start = new Date(ref);
    start.setDate(start.getDate() - 14);
    dateFrom = toDateKey(start);
    dateTo = toDateKey(end);
    matchedLabel = 'Last Week';
  } else if (/\b(is hafte|this week)\b/i.test(lower)) {
    const start = new Date(ref);
    start.setDate(start.getDate() - 6);
    dateFrom = toDateKey(start);
    dateTo = toDateKey(ref);
    matchedLabel = 'This Week';
  } else {
    // Check explicit weekday name ("monday", "somwar", etc.)
    const words = lower.match(/[a-z]+/g) || [];
    for (const w of words) {
      if (WEEKDAY_MAP[w] !== undefined) {
        const targetDow = WEEKDAY_MAP[w];
        const diff = (ref.getDay() - targetDow + 7) % 7 || 7;
        const d = new Date(ref);
        d.setDate(d.getDate() - diff);
        dateKey = toDateKey(d);
        matchedLabel = `${w} (${dateKey})`;
        break;
      }
    }
  }

  // Extract optional topic keyword (after stripping filler & date words)
  const topic = lower
    .replace(/\b\d{1,2}\s+(?:din|days?)\b/gi, ' ')
    .replace(/\b(aaj|today|kal|yesterday|parso|subah|morning|dopahar|afternoon|shaam|evening|raat|night|is hafte|this week|pichle hafte|last week|pichle|last|past|days?|din|pehle|pahle|ago)\b/gi, ' ')
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|ravivar|somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar)\b/gi, ' ')
    .replace(/\b(\d{1,2}\s*(?:jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|mai|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*)(?:\s+\d{2,4})?|(?:jan[a-z]*|feb[a-z]*|mar[a-z]*|apr[a-z]*|may|mai|jun[a-z]*|jul[a-z]*|aug[a-z]*|sep[a-z]*|oct[a-z]*|nov[a-z]*|dec[a-z]*)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/gi, ' ')
    .replace(/\b(maine|main|humne|hamne|ham|kya|kab|kaun|kon|sa|din|ko|ke|ki|ka|me|mein|baare|bare|pucha|bola|kaha|diya|kiya|tha|thi|the|baat|hui|jeeva|ne|jawaab|jawab|what|did|ask|asked|say|said|talk|discuss|about|you|answer|tell|show|history|memory|record|on|at|in|the|is)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    dateKey,
    dateFrom,
    dateTo,
    weekday,
    timeOfDay,
    topic: topic.length >= 2 ? topic : '',
    matchedLabel: matchedLabel || 'Recent Timeline',
  };
}
