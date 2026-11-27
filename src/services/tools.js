import { getSystemAPI, executeMobileBrowserAction } from './bridge.js';
import { queryEpisodicTimeline } from './episodicMemory.js';
import { summarizeTextLocally } from './docExtractor.js';
import {
  PERMISSION_CATEGORIES,
  getToolCategory,
  getToolRiskLevel,
  isSensitiveVoiceAction,
  getTargetScope,
  isTargetAllowed,
  allowTargetPermanently,
  formatToolSummary,
  getCategoryPolicy,
  allowCategoryForSession,
  clearSessionCategoryPermissions,
  getPermissionRules,
  savePermissionRules,
  appendAuditLog,
  isRemoteEnvironment,
} from './permissions.js';

const sessionAllowedTools = new Set();

export function clearToolSessionPermissions() {
  sessionAllowedTools.clear();
  clearSessionCategoryPermissions();
}

export const TOOLS = [
  {
    type: 'function',
    name: 'open_application',
    description:
      "Opens an application on the user's computer (e.g., chrome, notepad, calculator, explorer, cmd, settings, vscode, spotify, vlc, whatsapp, wt), optionally with a folder/file/URL argument.",
    parameters: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'Application name to open' },
        args: { type: 'string', description: 'Optional file path, folder path, or URL argument to pass to the app' },
      },
      required: ['app_name'],
    },
  },
  {
    type: 'function',
    name: 'close_application',
    description: 'Closes a running application by name (e.g., chrome, notepad).',
    parameters: {
      type: 'object',
      properties: {
        app_name: { type: 'string', description: 'Application process name to close' },
      },
      required: ['app_name'],
    },
  },
  {
    type: 'function',
    name: 'get_running_apps',
    description: 'Lists currently open windows and running applications on the PC.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'open_url',
    description: 'Opens a URL in the default browser.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL starting with https://' },
      },
      required: ['url'],
    },
  },
  {
    type: 'function',
    name: 'search_web',
    description: 'Opens Google search in the browser for a query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'browser_control',
    description:
      'Controls active PC web browser (Chrome/Edge/Brave): read active tab title & URL, read full page text & list/switch tabs (via CDP port 9222 or launch_debug), open URL, new/close/reopen/next/prev tabs, back/forward/refresh, find text on page, or play/pause/skip YouTube ads/videos.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'active_tab_info',
            'list_tabs',
            'switch_tab',
            'read_page',
            'open_url',
            'new_tab',
            'new_incognito',
            'close_tab',
            'reopen_tab',
            'next_tab',
            'prev_tab',
            'downloads',
            'history',
            'bookmarks',
            'zoom_in',
            'zoom_out',
            'zoom_reset',
            'back',
            'forward',
            'refresh',
            'find_on_page',
            'youtube_play_pause',
            'youtube_next',
            'youtube_prev',
            'youtube_mute',
            'youtube_fullscreen',
            'youtube_theater',
            'youtube_captions',
            'youtube_forward',
            'youtube_rewind',
            'youtube_speed_up',
            'youtube_speed_down',
            'youtube_skip_ad',
            'launch_debug',
          ],
          description: 'Browser tab or page action',
        },
        value: { type: 'string', description: 'Tab keyword/index, URL, or search query (when applicable)' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'control_volume',
    description:
      'Controls Windows master audio volume: increase (up), decrease (down), set exact percentage (set with level 0-100), mute, unmute, or check current volume (get).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['up', 'down', 'set', 'mute', 'unmute', 'get'], description: 'Volume action' },
        level: { type: 'number', description: 'Volume percentage (0 to 100) for action=set, or step size for up/down' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'media_control',
    description: 'Controls music/video playback (play_pause, next, previous, stop).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop'] },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'brightness_control',
    description: 'Controls laptop screen brightness: get current level, set exact percentage (0-100), increase (up), or decrease (down).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'up', 'down'], description: 'Brightness action' },
        level: { type: 'number', description: 'Brightness percentage (0 to 100) for set, or step for up/down' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'open_windows_setting',
    description:
      'Opens any Windows Settings page directly (wifi, bluetooth, display, sound, battery, power, privacy, apps, windowsupdate, network, notifications, storage, personalization, theme, accounts, time, keyboard, mouse, devices, hotspot, airplane, vpn, about, camera, mic, main).',
    parameters: {
      type: 'object',
      properties: {
        setting: { type: 'string', description: 'Setting page key e.g. wifi, bluetooth, display, sound, windowsupdate, theme' },
      },
      required: ['setting'],
    },
  },
  {
    type: 'function',
    name: 'toggle_windows_theme',
    description: 'Switches Windows theme between Dark Mode and Light Mode.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['dark', 'light', 'toggle'] },
      },
      required: ['mode'],
    },
  },
  {
    type: 'function',
    name: 'get_battery_status',
    description: 'Checks laptop battery percentage and charging status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_wifi_status',
    description: 'Checks current Wi-Fi network connection details or disconnects Wi-Fi.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['status', 'disconnect'] },
      },
    },
  },
  {
    type: 'function',
    name: 'press_shortcut',
    description:
      'Executes a Windows keyboard shortcut such as minimize_all, switch_window, close_window, copy, paste, select_all, undo, save, enter, escape, space.',
    parameters: {
      type: 'object',
      properties: {
        shortcut: { type: 'string', description: 'Shortcut name or SendKeys string' },
      },
      required: ['shortcut'],
    },
  },
  {
    type: 'function',
    name: 'adb_phone_control',
    description:
      'Controls an Android phone connected to PC via ADB (USB or Wireless Debugging): list devices, home, back, volume_up, volume_down, media_play_pause, open_url, open_app (package name), brightness (0-100), lock.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['devices', 'home', 'back', 'volume_up', 'volume_down', 'media_play_pause', 'open_url', 'open_app', 'brightness', 'lock'] },
        arg: { type: 'string', description: 'URL, package name, or brightness value' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'mobile_browser_action',
    description: 'Runs a native mobile browser action directly on the phone (battery, vibrate, open_whatsapp, dial_number, open_link).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['battery', 'vibrate', 'open_whatsapp', 'dial_number', 'open_link'] },
        value: { type: 'string', description: 'Phone number or URL if applicable' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'system_power',
    description: 'Controls PC power state: lock, sleep, restart, or shutdown.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['lock', 'sleep', 'restart', 'shutdown'] },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'take_screenshot',
    description: "Takes a screenshot of the user's primary screen and returns image + DPI coordinate dimensions for accurate mouse clicks.",
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_system_info',
    description: 'Gets PC hardware and OS info (CPU, RAM, uptime, username).',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'manage_clipboard',
    description: 'Reads from or writes text to the clipboard.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'write'] },
        text: { type: 'string', description: 'Text to copy (for write)' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'type_text',
    description: 'Types text or keyboard shortcuts into the active window.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text or SendKeys sequence to type' },
      },
      required: ['text'],
    },
  },
  {
    type: 'function',
    name: 'save_desktop_note',
    description: "Saves a text note, summary, or code file directly onto the user's Desktop.",
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Filename e.g. notes.txt' },
        content: { type: 'string', description: 'File text content' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    type: 'function',
    name: 'file_operation',
    description: 'List, search, read text files, write, or delete files on the PC.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'search', 'read', 'write', 'delete'] },
        path: { type: 'string', description: 'File or folder path' },
        query: { type: 'string', description: 'Search query (for search)' },
        content: { type: 'string', description: 'Content (for write)' },
      },
      required: ['operation'],
    },
  },
  {
    type: 'function',
    name: 'read_document_file',
    description: "Reads a local PDF, DOCX, PPTX, or XLSX file from the user's computer so you can summarize or read it aloud.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path to the PDF or document file' },
        instruction: { type: 'string', description: 'What to extract or read from the document' },
      },
      required: ['path'],
    },
  },
  {
    type: 'function',
    name: 'run_system_command',
    description: 'Runs a Windows terminal/PowerShell command.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
      },
      required: ['command'],
    },
  },
  {
    type: 'function',
    name: 'list_installed_software',
    description: 'Lists installed Windows software/programs (Registry + Start Menu), optionally filtered by a search keyword.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional filter text e.g. "vlc" or "python"' },
      },
    },
  },
  {
    type: 'function',
    name: 'manage_software',
    description: 'Searches, installs, uninstalls, or updates Windows software/apps using winget.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'install', 'uninstall', 'update'], description: 'Software operation' },
        package: { type: 'string', description: 'Software name or winget package ID (e.g. VideoLAN.VLC, Microsoft.VisualStudioCode)' },
      },
      required: ['action', 'package'],
    },
  },
  {
    type: 'function',
    name: 'control_app_window',
    description: 'Controls an open application window: focus (bring to front), maximize, minimize, restore, snap_left, snap_right, or close.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['focus', 'maximize', 'minimize', 'restore', 'snap_left', 'snap_right', 'close'] },
        app_name: { type: 'string', description: 'Running app process name or window title' },
      },
      required: ['action', 'app_name'],
    },
  },
  {
    type: 'function',
    name: 'ui_automate',
    description: 'Inspects UI controls inside an open Windows application window, clicks a UI element by name, or sets text inside an input element.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['inspect', 'click', 'set_text'], description: 'UI automation action' },
        app_name: { type: 'string', description: 'Target running app process or window title' },
        element: { type: 'string', description: 'UI control/button/field name (required for click and set_text)' },
        value: { type: 'string', description: 'Text to type into the input element (required for set_text)' },
      },
      required: ['action', 'app_name'],
    },
  },
  {
    type: 'function',
    name: 'mouse_and_hotkey',
    description:
      'Controls physical PC mouse coordinates with automatic DPI scaling & visual target reticle (move, click, double_click, right_click, scroll, drag), sends true Windows keyboard hotkeys (like ctrl+shift+t, win+d, alt+tab, win+r), or pastes Unicode text cleanly.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['move', 'click', 'double_click', 'right_click', 'scroll', 'drag', 'hotkey', 'paste_text'] },
        x: { type: 'integer', description: 'Target X coordinate' },
        y: { type: 'integer', description: 'Target Y coordinate' },
        x2: { type: 'integer', description: 'Destination X coordinate (for drag)' },
        y2: { type: 'integer', description: 'Destination Y coordinate (for drag)' },
        delta: { type: 'integer', description: 'Scroll wheel notches (positive up, negative down, e.g. -3)' },
        coord_space: { type: 'string', enum: ['pixels', 'normalized_1000'], description: 'pixels = screenshot image pixels; normalized_1000 = 0..1000 grid' },
        keys: { type: 'string', description: 'Hotkey combination (e.g. ctrl+c, ctrl+shift+t, win+d, alt+tab)' },
        text: { type: 'string', description: 'Text to paste cleanly into active window' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'system_diagnostics',
    description: 'Runs deep Windows PC diagnostics: CPU/RAM/GPU/disk overview, top memory/CPU consuming processes, listening TCP ports, disk breakdown, or killing a process by PID or name.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['overview', 'top_processes', 'kill_process', 'disks', 'ports'] },
        target: { type: 'string', description: 'PID or process name (for kill_process), or sort key ("cpu" or count)' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'file_manager_pro',
    description: 'Organizes cluttered folders ("downloads", "desktop") by file type, creates folders (mkdir), moves, renames, zips, or unzips archives.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['organize_folder', 'mkdir', 'move', 'rename', 'zip', 'unzip'] },
        source: { type: 'string', description: 'Source path or shortcut ("downloads", "desktop", "documents")' },
        dest: { type: 'string', description: 'Destination path, zip archive path, or new name' },
      },
      required: ['action', 'source'],
    },
  },
  {
    type: 'function',
    name: 'clipboard_history',
    description: 'Inspects recent clipboard history (last 20 copied entries), clears it, or pastes an earlier entry by index.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'paste_index', 'clear'] },
        index: { type: 'integer', description: 'Zero-based history index to paste (0 = most recent)' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'schedule_pc_task',
    description: 'Sets timed Windows desktop + spoken reminders, schedules delayed system commands (with cancel support), or lists active tasks & macros.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['remind', 'remind_date', 'agenda', 'ack', 'delayed_command', 'list', 'cancel'] },
        delay_minutes: { type: 'number', description: 'Delay in minutes from now (e.g. 5 or 0.5)' },
        trigger_at: { type: 'number', description: 'Epoch ms for scheduled calendar date/time reminder' },
        date_key: { type: 'string', description: 'Date key YYYY-MM-DD' },
        has_explicit_time: { type: 'boolean', description: 'Whether a specific clock time was requested' },
        time_label: { type: 'string', description: 'Human-readable clock time e.g. 6:00 PM' },
        early_warn_minutes: { type: 'number', description: 'Advance warning minutes before event (default 30)' },
        message: { type: 'string', description: 'Reminder message or task description' },
        command: { type: 'string', description: 'Shell command for delayed_command' },
        task_id: { type: 'string', description: 'Task ID to cancel/acknowledge, or "all"' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'pc_power_tools',
    description: 'Controls Windows power plan (balanced, high_performance, power_saver), empties Recycle Bin, or reads display resolution & cursor position.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['power_plan', 'empty_recycle_bin', 'display_info'] },
        plan: { type: 'string', enum: ['get', 'balanced', 'high_performance', 'power_saver'] },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'memory_rag',
    description:
      'Saves or recalls persistent long-term user facts, preferences, frequent project paths, and past workflows locally.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['remember', 'recall', 'list', 'forget'] },
        text: { type: 'string', description: 'Fact/folder/preference to remember, search query to recall, or memory ID to forget' },
        category: { type: 'string', enum: ['preference', 'project', 'folder', 'command', 'fact'] },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'episodic_recall',
    description:
      'Queries past user conversations and commands by date, weekday, time of day, or topic (e.g. what the user asked yesterday, on a specific date, or last Monday).',
    parameters: {
      type: 'object',
      properties: {
        date_key: { type: 'string', description: 'Exact date in YYYY-MM-DD format if known' },
        date_from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        date_to: { type: 'string', description: 'End date YYYY-MM-DD' },
        weekday: { type: 'string', description: 'Weekday name e.g. Monday' },
        time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'night'] },
        topic: { type: 'string', description: 'Optional keyword or topic' },
      },
    },
  },
  {
    type: 'function',
    name: 'screen_reader',
    description:
      'Reads visible text, headings, errors, and interactive buttons/inputs on the active Windows screen offline (UIA + WinRT OCR), or clicks/types into a visible screen element.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'ocr', 'click_text', 'type_into'] },
        target_text: { type: 'string', description: 'Button label, field name, or visible text to click or type into' },
        input_value: { type: 'string', description: 'Text to type when action is type_into' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'generate_image_tool',
    description: 'Generates an image from a text prompt when the user asks to create/draw/generate a picture, logo, or wallpaper.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed image description in English' },
      },
      required: ['prompt'],
    },
  },
];

function guessDocumentMime(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/pdf';
}

export async function executeFunctionCall(
  name,
  args = {},
  requestPermission = null,
  { client, preferredModel, generateImage, fromVoice = false, userPrompt = '' } = {}
) {
  if (name === 'generate_image_tool') {
    const imageUrl = await generateImage(args.prompt);
    return { result: 'Image generated successfully', generatedImage: imageUrl };
  }

  const isLocalWebTool = name === 'mobile_browser_action' || name === 'episodic_recall';
  const api = getSystemAPI();
  if (!isLocalWebTool && !api) {
    return {
      error:
        'PC connected nahi hai. Ya to PC app par Render Cloud Relay connect karein, ya Link to PC mein 4-digit PIN daalein.',
    };
  }

  const category = getToolCategory(name, args);
  const catMeta = PERMISSION_CATEGORIES.find((c) => c.id === category);
  const policy = getCategoryPolicy(category);
  const riskLevel = getToolRiskLevel(name, args);
  const summary = formatToolSummary(name, args);
  const targetScope = getTargetScope(name, args);

  if (policy === 'block') {
    appendAuditLog({ tool: name, category, summary, decision: 'blocked' });
    return { error: `Blocked by Permission Center (${catMeta?.label || category}).` };
  }

  const alwaysAskHigh = riskLevel === 'high';
  const sensitiveVoicePrompt = Boolean(fromVoice && isSensitiveVoiceAction(name, args));
  const targetBypass = Boolean(!alwaysAskHigh && targetScope && isTargetAllowed(targetScope));
  const needsPrompt =
    !sessionAllowedTools.has(name) &&
    !targetBypass &&
    (alwaysAskHigh || sensitiveVoicePrompt || policy === 'ask');

  if (needsPrompt && requestPermission) {
    const decision = await requestPermission({
      name,
      args,
      riskLevel,
      category,
      categoryLabel: catMeta?.label || category,
      summary,
      targetScope,
      isRemote: isRemoteEnvironment(),
      fromVoice: Boolean(fromVoice),
      userPrompt,
    });

    if (!decision || decision === 'deny') {
      appendAuditLog({ tool: name, category, summary, decision: 'denied' });
      return { error: 'User denied permission for this action.' };
    }

    if (decision === 'always_target' && targetScope && riskLevel !== 'high') {
      allowTargetPermanently(targetScope);
    } else if (decision === 'session_category' && riskLevel !== 'high') {
      allowCategoryForSession(category);
    } else if (decision === 'always_category' && riskLevel !== 'high') {
      savePermissionRules({ ...getPermissionRules(), [category]: 'always' });
    } else if (decision === 'always' && riskLevel !== 'high') {
      sessionAllowedTools.add(name);
    }

    appendAuditLog({ tool: name, category, summary, decision: `allowed (${decision})` });
  } else {
    appendAuditLog({ tool: name, category, summary, decision: `allowed (${targetBypass ? targetScope : policy})` });
  }

  if (name === 'mobile_browser_action') {
    return { result: await executeMobileBrowserAction(args.action, args.value) };
  }

  async function readLocalDocument(filePath, instruction) {
    // 1. Try 100% Local Offline Extraction FIRST (PDF FlateDecode, DOCX/PPTX/XLSX XML, TXT)
    if (api.extractDocText) {
      try {
        const localDoc = await api.extractDocText({ filePath, name: filePath });
        if (localDoc?.ok && !localDoc.isScannedPdf && localDoc.text) {
          const wantShortSummary = /\b(summary|summarize|short|brief|points)\b/i.test(instruction || '');
          if (wantShortSummary && !client) {
            return `Local Summary (${localDoc.name}):\n\n${summarizeTextLocally(localDoc.text, 6)}`;
          }
          return localDoc.text.slice(0, 6500);
        }
      } catch {}
    }

    // 2. Fallback to Gemini ONLY if scanned/image PDF and Gemini client is ready
    if (!client) {
      throw new Error('Yeh scanned/image PDF hai — local text extract nahi mila, aur Gemini API connected nahi hai.');
    }
    const file = await api.readBinaryFile(filePath);
    const mime = guessDocumentMime(filePath);
    const models = Array.from(new Set([preferredModel, 'gemini-3.5-flash-lite', 'gemini-4-hydrogen']));
    let lastErr;
    for (const model of models) {
      try {
        const interaction = await client.interactions.create({
          model,
          input: [
            { type: 'text', text: instruction || 'Extract and read all text clearly from this document.' },
            { type: 'document', data: file.base64, mime_type: mime },
          ],
          store: false,
        });
        return interaction.output_text || 'Document read completed.';
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  try {
    switch (name) {
      case 'open_application':
        return { result: await api.openApp(args.app_name, args.args || '') };
      case 'close_application':
        return { result: await api.closeApp(args.app_name) };
      case 'get_running_apps':
        return { result: await api.runningApps() };
      case 'list_installed_software':
        return { result: await api.listInstalledApps(args.filter || '') };
      case 'manage_software':
        return { result: await api.manageSoftware(args.action, args.package) };
      case 'control_app_window':
        return { result: await api.windowControl(args.action, args.app_name) };
      case 'ui_automate':
        return { result: await api.uiAutomate(args.action, args.app_name, args.element || '', args.value || '') };
      case 'browser_control':
        return { result: await api.browserControl(args.action || 'active_tab_info', args.value || '') };
      case 'open_url':
        return { result: await api.openURL(args.url) };
      case 'search_web':
        await api.openURL(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`);
        return { result: `Opened Google search for: ${args.query}` };
      case 'control_volume':
        if (!args?.action) return { error: 'Missing volume action (up, down, set, mute, unmute, get)' };
        return { result: await api.volume(args.action, args.level) };
      case 'media_control':
        return { result: await api.media(args.action) };
      case 'brightness_control':
        if (!args?.action) return { error: 'Missing brightness action (get, set, up, down)' };
        return { result: await api.brightness(args.action, args.level) };
      case 'open_windows_setting':
        return { result: await api.openSetting(args.setting) };
      case 'toggle_windows_theme':
        return { result: await api.theme(args.mode || 'toggle') };
      case 'get_battery_status':
        return { result: await api.battery() };
      case 'get_wifi_status':
        return { result: await api.wifi(args.mode || 'status') };
      case 'press_shortcut': {
        if (args.shortcut === 'minimize_all') return { result: await api.minimizeAll() };
        const shortcuts = {
          switch_window: '%{TAB}',
          close_window: '%{F4}',
          copy: '^c',
          paste: '^v',
          select_all: '^a',
          undo: '^z',
          save: '^s',
          enter: '{ENTER}',
          escape: '{ESC}',
          space: ' ',
        };
        return { result: await api.typeText(shortcuts[args.shortcut] || args.shortcut) };
      }
      case 'adb_phone_control':
        return { result: await api.adbControl(args.action, args.arg) };
      case 'system_power':
        return { result: await api.power(args.action) };
      case 'take_screenshot': {
        const ss = await api.screenshot();
        const m = ss.meta;
        const dimHint = m
          ? ` (${m.imageWidth}x${m.imageHeight} image, physical ${m.physicalWidth}x${m.physicalHeight}, scale ${m.scaleFactor}x)`
          : '';
        return { result: `Screenshot captured${dimHint}`, screenshot: ss.base64, meta: m };
      }
      case 'get_system_info':
        return { result: JSON.stringify(await api.systemInfo(), null, 2) };
      case 'manage_clipboard':
        if (args.action === 'read') return { result: await api.clipboard('read') };
        return { result: await api.clipboard('write', args.text || '') };
      case 'type_text':
        return { result: await api.typeText(args.text) };
      case 'save_desktop_note':
        return { result: await api.saveDesktopFile(args.filename, args.content) };
      case 'file_operation':
        switch (args.operation) {
          case 'list': {
            const files = await api.listFiles(args.path);
            return { result: files.map((f) => `${f.isDirectory ? '📁' : '📄'} ${f.name}`).join('\n') };
          }
          case 'search': {
            const found = await api.searchFiles(args.query, args.path);
            return {
              result:
                found.length > 0
                  ? found.map((f) => `${f.isDirectory ? '📁' : '📄'} ${f.path}`).join('\n')
                  : 'No files found',
            };
          }
          case 'read':
            if (/\.(pdf|docx|pptx|xlsx)$/i.test(args.path || '')) {
              return { result: await readLocalDocument(args.path) };
            }
            return { result: await api.readFile(args.path) };
          case 'write':
            return { result: await api.writeFile(args.path, args.content) };
          case 'delete':
            return { result: await api.deleteFile(args.path) };
          default:
            return { error: 'Unknown file operation' };
        }
      case 'read_document_file':
        return { result: await readLocalDocument(args.path, args.instruction) };
      case 'run_system_command':
        return { result: await api.runCommand(args.command) };
      case 'mouse_and_hotkey': {
        const act = String(args.action || 'click').toLowerCase();
        if (act === 'hotkey') return { result: await api.sendHotkey(args.keys || '') };
        if (act === 'paste_text') return { result: await api.typeClipboard(args.text || '') };
        return {
          result: await api.mouseAction(
            act,
            args.x ?? 0,
            args.y ?? 0,
            args.x2 ?? 0,
            args.y2 ?? 0,
            args.delta ?? -3,
            args.coord_space || 'pixels'
          ),
        };
      }
      case 'system_diagnostics': {
        const act = String(args.action || 'overview').toLowerCase();
        if (act === 'kill_process') {
          return { result: await api.manageProcess('kill_process', args.target || '') };
        }
        return { result: await api.diagnostics(act, args.target || '') };
      }
      case 'file_manager_pro':
        return {
          result: await api.filePro(args.action || 'organize_folder', args.source || '', args.dest || ''),
        };
      case 'clipboard_history':
        return { result: await api.clipboardHistory(args.action || 'list', args.index ?? 0) };
      case 'schedule_pc_task': {
        const act = String(args.action || 'list').toLowerCase();
        if (act === 'remind') {
          return { result: await api.scheduler('remind', args.delay_minutes ?? 5, args.message || 'Reminder') };
        }
        if (act === 'remind_date') {
          return {
            result: await api.scheduler('remind_date', {
              triggerAt: args.trigger_at,
              dateKey: args.date_key || '',
              hasExplicitTime: Boolean(args.has_explicit_time),
              timeLabel: args.time_label || '',
              message: args.message || 'Scheduled Reminder',
              earlyWarnMinutes: args.early_warn_minutes ?? 30,
            }),
          };
        }
        if (act === 'agenda') {
          return { result: await api.scheduler('agenda') };
        }
        if (act === 'ack') {
          return { result: await api.scheduler('ack', args.task_id || 'all') };
        }
        if (act === 'delayed_command') {
          return {
            result: await api.scheduler('delayed_command', args.delay_minutes ?? 5, args.command || '', args.message || ''),
          };
        }
        if (act === 'cancel') {
          return { result: await api.scheduler('cancel', args.task_id || 'all') };
        }
        return { result: await api.scheduler('list') };
      }
      case 'pc_power_tools': {
        const act = String(args.action || 'display_info').toLowerCase();
        if (act === 'power_plan') return { result: await api.powerProfile(args.plan || 'get') };
        if (act === 'empty_recycle_bin') return { result: await api.emptyRecycleBin() };
        return { result: await api.diagnostics('display_info') };
      }
      case 'memory_rag': {
        const res = await api.memoryRag(args.action || 'recall', args.text || '', args.category || 'fact');
        return { result: JSON.stringify(res) };
      }
      case 'episodic_recall': {
        const rows = await queryEpisodicTimeline({
          dateKey: args.date_key || '',
          dateFrom: args.date_from || '',
          dateTo: args.date_to || '',
          weekday: args.weekday || '',
          timeOfDay: args.time_of_day || '',
          topic: args.topic || '',
          limit: 12,
        });
        return { result: JSON.stringify({ count: rows.length, entries: rows }) };
      }
      case 'screen_reader': {
        const act = String(args.action || 'read').toLowerCase();
        if (act === 'type_into') {
          return {
            result: await api.uiAutomate('set_text', 'foreground', args.target_text || '', args.input_value || ''),
          };
        }
        const sr = await api.screenRead(act, args.target_text || '');
        return { result: typeof sr === 'string' ? sr : JSON.stringify(sr) };
      }
      default:
        return { error: `Unknown function: ${name}` };
    }
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}
