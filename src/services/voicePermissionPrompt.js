// Language-aware Voice & Chat Permission Question Builder + Yes/No Intent Parser

const HINGLISH_MARKERS = new Set([
  'hai', 'hain', 'ho', 'hun', 'hoon', 'hu', 'ka', 'ki', 'ke', 'ko', 'se', 'mein',
  'par', 'pe', 'ne', 'nahi', 'nhi', 'na', 'kya', 'kay', 'kaise', 'kasa', 'kab', 'kahan',
  'kyun', 'kyu', 'batao', 'bata', 'sunao', 'karo', 'kro', 'kr', 'krna', 'karna', 'krwa',
  'karwa', 'raha', 'rahi', 'rahe', 'hamko', 'humko', 'mujhe', 'mjhe', 'mera', 'meri',
  'mere', 'aap', 'ap', 'hum', 'ham', 'kholo', 'khol', 'band', 'chalao', 'chala', 'badhao',
  'badha', 'kam', 'ghatao', 'hatao', 'hata', 'daalo', 'dalo', 'chahiye', 'chia', 'phala',
  'pehle', 'sab', 'kuch', 'ek', 'kar', 'kardo', 'dena', 'lena', 'sakte', 'sakto', 'haan',
  'han', 'bhai', 'yaar', 'abhi', 'zara', 'thoda', 'sach', 'walai', 'wala', 'usko', 'esko',
]);

/**
 * Detects whether a spoken/typed command is Hindi (Devanagari), Hinglish, or English.
 */
export function detectCommandLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'hinglish';

  const devCount = (raw.match(/[\u0900-\u097F]/g) || []).length;
  const latinCount = (raw.match(/[a-zA-Z]/g) || []).length;
  if (devCount > 0 && devCount >= latinCount * 0.25) {
    return 'hindi';
  }

  const words = raw.toLowerCase().match(/[a-z]+/g) || [];
  let hits = 0;
  for (const w of words) {
    if (HINGLISH_MARKERS.has(w)) hits++;
  }
  if (hits >= 1) return 'hinglish';
  return 'english';
}

function cleanTargetLabel(raw, fallback = 'this') {
  const s = String(raw || '').trim();
  return s || fallback;
}

/**
 * Generates a natural localized confirmation question in English, Hinglish, or Hindi
 * before running sensitive software, settings, file, or system actions.
 */
export function buildLocalizedPermissionQuestion(req = {}, lang = 'hinglish') {
  const name = req.name || '';
  const args = req.args || {};

  if (name === 'manage_software') {
    const pkg = cleanTargetLabel(args.package, 'this software');
    const act = String(args.action || 'install').toLowerCase();
    if (act === 'uninstall') {
      if (lang === 'english') {
        return `Are you sure you want to uninstall ${pkg} from your PC? Say yes to confirm or no to cancel.`;
      }
      if (lang === 'hindi') {
        return `क्या आप सच में ${pkg} को अनइंस्टॉल करना चाहते हैं? पुष्टि के लिए हाँ कहें या रद्द करने के लिए नहीं।`;
      }
      return `Kya aap sach mein ${pkg} ko uninstall karna chahte hain? Confirm karne ke liye Haan bolein ya Nahi bolein.`;
    }
    if (act === 'update') {
      if (lang === 'english') {
        return `Do you want me to update ${pkg} on your PC? Say yes or no.`;
      }
      if (lang === 'hindi') {
        return `क्या मैं आपके पीसी पर ${pkg} को अपडेट कर दूँ? हाँ या नहीं कहें।`;
      }
      return `Kya main aapke PC par ${pkg} update kar doon? Confirm ke liye Haan ya Nahi bolein.`;
    }
    if (lang === 'english') {
      return `Do you want me to install ${pkg} on your PC? Say yes to allow or no to cancel.`;
    }
    if (lang === 'hindi') {
      return `क्या मैं आपके पीसी पर ${pkg} इंस्टॉल कर दूँ? हाँ या नहीं कहें।`;
    }
    return `Kya main aapke PC par ${pkg} install kar doon? Confirm karne ke liye Haan ya Nahi bolein.`;
  }

  if (name === 'open_windows_setting') {
    const setting = cleanTargetLabel(args.setting, 'Windows').replace(/_/g, ' ');
    if (lang === 'english') {
      return `Do you want me to open and adjust ${setting} settings? Say yes or no.`;
    }
    if (lang === 'hindi') {
      return `क्या मैं ${setting} सेटिंग खोलकर बदल दूँ? हाँ या नहीं कहें।`;
    }
    return `Kya main ${setting} setting kholkar change kar doon? Haan ya Nahi bolein.`;
  }

  if (name === 'toggle_windows_theme') {
    const mode = cleanTargetLabel(args.mode, 'dark');
    if (lang === 'english') return `Switch Windows theme to ${mode} mode? Say yes or no.`;
    if (lang === 'hindi') return `क्या मैं विंडोज़ थीम को ${mode} मोड में बदल दूँ? हाँ या नहीं कहें।`;
    return `Kya main Windows theme ${mode} mode mein badal doon? Haan ya Nahi bolein.`;
  }

  if (name === 'pc_power_tools') {
    const act = String(args.action || '').toLowerCase();
    if (act === 'empty_recycle_bin') {
      if (lang === 'english') {
        return 'This will permanently empty your Recycle Bin. Are you sure you want to proceed? Say yes or no.';
      }
      if (lang === 'hindi') {
        return 'इससे रीसायकल बिन हमेशा के लिए खाली हो जाएगा। क्या आप पक्का हैं? हाँ या नहीं कहें।';
      }
      return 'Kya aap sach mein Recycle Bin permanently khali karna chahte hain? Haan ya Nahi bolein.';
    }
    const plan = cleanTargetLabel(args.plan, 'balanced').replace(/_/g, ' ');
    if (lang === 'english') return `Change PC power plan to ${plan}? Say yes or no.`;
    if (lang === 'hindi') return `क्या मैं पीसी पावर प्लान ${plan} पर सेट कर दूँ? हाँ या नहीं कहें।`;
    return `Kya main PC power plan ${plan} par change kar doon? Haan ya Nahi bolein.`;
  }

  if (name === 'system_power') {
    const act = cleanTargetLabel(args.action, 'shutdown');
    if (lang === 'english') {
      return `Warning: this will ${act} your PC right now. Are you sure? Say yes or no.`;
    }
    if (lang === 'hindi') {
      return `सावधान: इससे आपका पीसी ${act} हो जाएगा। क्या आप जारी रखना चाहते हैं? हाँ या नहीं कहें।`;
    }
    return `Savdhaan: isse aapka PC ${act} ho jayega. Kya aap sach mein aage badhna chahte hain? Haan ya Nahi bolein.`;
  }

  if (name === 'close_application' || (name === 'system_diagnostics' && args.action === 'kill_process')) {
    const app = cleanTargetLabel(args.app_name || args.target, 'this app');
    if (lang === 'english') return `Are you sure you want me to close ${app}? Say yes or no.`;
    if (lang === 'hindi') return `क्या आप सच में ${app} को बंद करना चाहते हैं? हाँ या नहीं कहें।`;
    return `Kya aap sach mein ${app} ko band karna chahte hain? Haan ya Nahi bolein.`;
  }

  if (name === 'file_operation' && args.operation === 'delete') {
    const target = cleanTargetLabel(args.path, 'this file');
    if (lang === 'english') return `Are you sure you want to delete ${target}? Say yes or no.`;
    if (lang === 'hindi') return `क्या आप सच में ${target} को डिलीट करना चाहते हैं? हाँ या नहीं कहें।`;
    return `Kya aap sach mein ${target} ko delete karna chahte hain? Haan ya Nahi bolein.`;
  }

  if (name === 'run_system_command') {
    const cmd = cleanTargetLabel(args.command, 'this command').slice(0, 60);
    if (lang === 'english') return `Should I run system command ${cmd}? Say yes or no.`;
    if (lang === 'hindi') return `क्या मैं यह सिस्टम कमांड चलाऊँ: ${cmd}? हाँ या नहीं कहें।`;
    return `Kya main yeh command run kar doon: ${cmd}? Haan ya Nahi bolein.`;
  }

  const summary = cleanTargetLabel(req.summary, name.replace(/_/g, ' '));
  if (lang === 'english') {
    return `Permission required for ${summary}. Should I proceed? Say yes or no.`;
  }
  if (lang === 'hindi') {
    return `इस कार्य के लिए अनुमति चाहिए: ${summary}। क्या मैं आगे बढ़ूँ? हाँ या नहीं कहें।`;
  }
  return `Kya main yeh action kar doon: ${summary}? Confirm karne ke liye Haan ya Nahi bolein.`;
}

const NO_WORDS = /\b(no|nope|nah|cancel|stop|deny|decline|abort|reject|skip|dont|don't|never|never mind|mat|nahi|nhi|na|naa|ruko|ruk|rehne|rahne)\b|नहीं|मत|रद्द|कैंसल|रुको|रहने/i;
const YES_WORDS = /\b(yes|yeah|yep|yup|sure|ok|okay|confirm|allow|approve|grant|permit|proceed|go ahead|do it|please do|accept|agreed|haan|han|ha|ji|kar|kardo|karo|de do|bilkul|zaroor|jaroor|theek|thik|chalega)\b|हाँ|हां|जी|कर दो|ठीक|बिल्कुल/i;

/**
 * Parses a spoken response to a permission question into 'yes' | 'no' | 'unclear'.
 */
export function parseVoiceConfirmation(transcript) {
  const raw = String(transcript || '').trim();
  if (!raw) return 'unclear';
  if (NO_WORDS.test(raw)) return 'no';
  if (YES_WORDS.test(raw)) return 'yes';
  return 'unclear';
}
