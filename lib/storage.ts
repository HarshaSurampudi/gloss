import type { Preferences } from './types';

const PREFS_KEY = 'prefs/v1';

const DEFAULT_PREFS: Preferences = {
  explainInLang: 'en',
  difficulty: 'auto',
  theme: 'auto',
  geminiModel: 'gemini-flash-latest',
  autoGenerate: true,
  translateTranscript: false,
  focusMode: false,
  keyMomentsEnabled: false,
};

function runtimeAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export async function getPrefs(): Promise<Preferences> {
  if (!runtimeAlive()) return { ...DEFAULT_PREFS };
  try {
    const raw = await chrome.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(raw[PREFS_KEY] ?? {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function setPrefs(patch: Partial<Preferences>): Promise<Preferences> {
  const current = await getPrefs();
  const next = { ...current, ...patch };
  if (!runtimeAlive()) return next;
  try {
    await chrome.storage.local.set({ [PREFS_KEY]: next });
  } catch {
    /* context gone */
  }
  return next;
}

export function onPrefsChanged(cb: (p: Preferences) => void) {
  if (!runtimeAlive()) return () => {};
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[PREFS_KEY]) cb(changes[PREFS_KEY].newValue as Preferences);
  };
  try {
    chrome.storage.onChanged.addListener(handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged.removeListener(handler);
    } catch {
      /* ignore */
    }
  };
}
