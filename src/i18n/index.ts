import i18n, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';

// English is bundled: it is the fallback for every language and the language of most users.
import enCommon from './locales/en/common.json';
import enHome from './locales/en/home.json';
import enSettings from './locales/en/settings.json';
import enHistory from './locales/en/history.json';
import enListExtractor from './locales/en/listExtractor.json';
import enPageExtractor from './locales/en/pageExtractor.json';
import enImageDownloader from './locales/en/imageDownloader.json';
import enSummarizer from './locales/en/summarizer.json';
import enUtilities from './locales/en/utilities.json';
import enWelcome from './locales/en/welcome.json';
import enMetadataExtractor from './locales/en/metadataExtractor.json';
import enDataTable from './locales/en/dataTable.json';
import { storage } from '../shared/storage';

export const SUPPORTED_LANGS = ['en', 'es', 'fr', 'de', 'it', 'zh', 'ja', 'ru', 'pt'] as const;
export type SupportedLang = typeof SUPPORTED_LANGS[number];

export const LANG_LABELS: Record<SupportedLang, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  zh: '中文（简体）',
  ja: '日本語',
  ru: 'Русский',
  pt: 'Português',
};

const namespaces = ['common', 'home', 'settings', 'history', 'listExtractor', 'pageExtractor', 'imageDownloader', 'summarizer', 'utilities', 'welcome', 'metadataExtractor', 'dataTable'] as const;

/**
 * Other languages load when used (at start, or when picked in Settings), each file its own chunk:
 * the side panel doesn't parse eight languages it won't show (`docs/plans/performance-plan.md` P3).
 */
const otherLocales = import.meta.glob<{ default: Record<string, unknown> }>(['./locales/*/*.json', '!./locales/en/*.json']);

const lazyLocales: BackendModule = {
  type: 'backend',
  init() { /* nothing to set up */ },
  read(lng, ns, done) {
    const load = otherLocales[`./locales/${lng}/${ns}.json`];
    if (!load) { done(null, {}); return; }
    load().then(m => done(null, m.default), err => done(err, null));
  },
};

export async function initI18n(): Promise<void> {
  const stored = (await storage.get('language')) || '';

  const browserLang = chrome.i18n.getUILanguage().split('-')[0];
  const detected = stored || browserLang;
  const lng: SupportedLang = (SUPPORTED_LANGS as readonly string[]).includes(detected)
    ? (detected as SupportedLang)
    : 'en';

  await i18n.use(lazyLocales).use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: namespaces,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    // English from the bundle; other languages through the backend.
    partialBundledLanguages: true,
    resources: {
      en: { common: enCommon, home: enHome, settings: enSettings, history: enHistory, listExtractor: enListExtractor, pageExtractor: enPageExtractor, imageDownloader: enImageDownloader, summarizer: enSummarizer, utilities: enUtilities, welcome: enWelcome, metadataExtractor: enMetadataExtractor, dataTable: enDataTable },
    },
    react: { useSuspense: false },
  });
}

export default i18n;
