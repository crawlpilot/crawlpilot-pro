import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English
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

// Spanish
import esCommon from './locales/es/common.json';
import esHome from './locales/es/home.json';
import esSettings from './locales/es/settings.json';
import esHistory from './locales/es/history.json';
import esListExtractor from './locales/es/listExtractor.json';
import esPageExtractor from './locales/es/pageExtractor.json';
import esImageDownloader from './locales/es/imageDownloader.json';
import esSummarizer from './locales/es/summarizer.json';
import esUtilities from './locales/es/utilities.json';
import esWelcome from './locales/es/welcome.json';
import esMetadataExtractor from './locales/es/metadataExtractor.json';
import esDataTable from './locales/es/dataTable.json';

// French
import frCommon from './locales/fr/common.json';
import frHome from './locales/fr/home.json';
import frSettings from './locales/fr/settings.json';
import frHistory from './locales/fr/history.json';
import frListExtractor from './locales/fr/listExtractor.json';
import frPageExtractor from './locales/fr/pageExtractor.json';
import frImageDownloader from './locales/fr/imageDownloader.json';
import frSummarizer from './locales/fr/summarizer.json';
import frUtilities from './locales/fr/utilities.json';
import frWelcome from './locales/fr/welcome.json';
import frMetadataExtractor from './locales/fr/metadataExtractor.json';
import frDataTable from './locales/fr/dataTable.json';

// German
import deCommon from './locales/de/common.json';
import deHome from './locales/de/home.json';
import deSettings from './locales/de/settings.json';
import deHistory from './locales/de/history.json';
import deListExtractor from './locales/de/listExtractor.json';
import dePageExtractor from './locales/de/pageExtractor.json';
import deImageDownloader from './locales/de/imageDownloader.json';
import deSummarizer from './locales/de/summarizer.json';
import deUtilities from './locales/de/utilities.json';
import deWelcome from './locales/de/welcome.json';
import deMetadataExtractor from './locales/de/metadataExtractor.json';
import deDataTable from './locales/de/dataTable.json';

// Italian
import itCommon from './locales/it/common.json';
import itHome from './locales/it/home.json';
import itSettings from './locales/it/settings.json';
import itHistory from './locales/it/history.json';
import itListExtractor from './locales/it/listExtractor.json';
import itPageExtractor from './locales/it/pageExtractor.json';
import itImageDownloader from './locales/it/imageDownloader.json';
import itSummarizer from './locales/it/summarizer.json';
import itUtilities from './locales/it/utilities.json';
import itWelcome from './locales/it/welcome.json';
import itMetadataExtractor from './locales/it/metadataExtractor.json';
import itDataTable from './locales/it/dataTable.json';

// Chinese (Simplified)
import zhCommon from './locales/zh/common.json';
import zhHome from './locales/zh/home.json';
import zhSettings from './locales/zh/settings.json';
import zhHistory from './locales/zh/history.json';
import zhListExtractor from './locales/zh/listExtractor.json';
import zhPageExtractor from './locales/zh/pageExtractor.json';
import zhImageDownloader from './locales/zh/imageDownloader.json';
import zhSummarizer from './locales/zh/summarizer.json';
import zhUtilities from './locales/zh/utilities.json';
import zhWelcome from './locales/zh/welcome.json';
import zhMetadataExtractor from './locales/zh/metadataExtractor.json';
import zhDataTable from './locales/zh/dataTable.json';

// Japanese
import jaCommon from './locales/ja/common.json';
import jaHome from './locales/ja/home.json';
import jaSettings from './locales/ja/settings.json';
import jaHistory from './locales/ja/history.json';
import jaListExtractor from './locales/ja/listExtractor.json';
import jaPageExtractor from './locales/ja/pageExtractor.json';
import jaImageDownloader from './locales/ja/imageDownloader.json';
import jaSummarizer from './locales/ja/summarizer.json';
import jaUtilities from './locales/ja/utilities.json';
import jaWelcome from './locales/ja/welcome.json';
import jaMetadataExtractor from './locales/ja/metadataExtractor.json';
import jaDataTable from './locales/ja/dataTable.json';

// Russian
import ruCommon from './locales/ru/common.json';
import ruHome from './locales/ru/home.json';
import ruSettings from './locales/ru/settings.json';
import ruHistory from './locales/ru/history.json';
import ruListExtractor from './locales/ru/listExtractor.json';
import ruPageExtractor from './locales/ru/pageExtractor.json';
import ruImageDownloader from './locales/ru/imageDownloader.json';
import ruSummarizer from './locales/ru/summarizer.json';
import ruUtilities from './locales/ru/utilities.json';
import ruWelcome from './locales/ru/welcome.json';
import ruMetadataExtractor from './locales/ru/metadataExtractor.json';
import ruDataTable from './locales/ru/dataTable.json';

// Portuguese
import ptCommon from './locales/pt/common.json';
import ptHome from './locales/pt/home.json';
import ptSettings from './locales/pt/settings.json';
import ptHistory from './locales/pt/history.json';
import ptListExtractor from './locales/pt/listExtractor.json';
import ptPageExtractor from './locales/pt/pageExtractor.json';
import ptImageDownloader from './locales/pt/imageDownloader.json';
import ptSummarizer from './locales/pt/summarizer.json';
import ptUtilities from './locales/pt/utilities.json';
import ptWelcome from './locales/pt/welcome.json';
import ptMetadataExtractor from './locales/pt/metadataExtractor.json';
import ptDataTable from './locales/pt/dataTable.json';
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

function makeResources(common: any, home: any, settings: any, history: any, listExtractor: any, pageExtractor: any, imageDownloader: any, summarizer: any, utilities: any, welcome: any, metadataExtractor: any, dataTable: any) {
  return { common, home, settings, history, listExtractor, pageExtractor, imageDownloader, summarizer, utilities, welcome, metadataExtractor, dataTable };
}

export async function initI18n(): Promise<void> {
  const stored = (await storage.get('language')) || '';

  const browserLang = chrome.i18n.getUILanguage().split('-')[0];
  const detected = stored || browserLang;
  const lng: SupportedLang = (SUPPORTED_LANGS as readonly string[]).includes(detected)
    ? (detected as SupportedLang)
    : 'en';

  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    ns: namespaces,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources: {
      en: makeResources(enCommon, enHome, enSettings, enHistory, enListExtractor, enPageExtractor, enImageDownloader, enSummarizer, enUtilities, enWelcome, enMetadataExtractor, enDataTable),
      es: makeResources(esCommon, esHome, esSettings, esHistory, esListExtractor, esPageExtractor, esImageDownloader, esSummarizer, esUtilities, esWelcome, esMetadataExtractor, esDataTable),
      fr: makeResources(frCommon, frHome, frSettings, frHistory, frListExtractor, frPageExtractor, frImageDownloader, frSummarizer, frUtilities, frWelcome, frMetadataExtractor, frDataTable),
      de: makeResources(deCommon, deHome, deSettings, deHistory, deListExtractor, dePageExtractor, deImageDownloader, deSummarizer, deUtilities, deWelcome, deMetadataExtractor, deDataTable),
      it: makeResources(itCommon, itHome, itSettings, itHistory, itListExtractor, itPageExtractor, itImageDownloader, itSummarizer, itUtilities, itWelcome, itMetadataExtractor, itDataTable),
      zh: makeResources(zhCommon, zhHome, zhSettings, zhHistory, zhListExtractor, zhPageExtractor, zhImageDownloader, zhSummarizer, zhUtilities, zhWelcome, zhMetadataExtractor, zhDataTable),
      ja: makeResources(jaCommon, jaHome, jaSettings, jaHistory, jaListExtractor, jaPageExtractor, jaImageDownloader, jaSummarizer, jaUtilities, jaWelcome, jaMetadataExtractor, jaDataTable),
      ru: makeResources(ruCommon, ruHome, ruSettings, ruHistory, ruListExtractor, ruPageExtractor, ruImageDownloader, ruSummarizer, ruUtilities, ruWelcome, ruMetadataExtractor, ruDataTable),
      pt: makeResources(ptCommon, ptHome, ptSettings, ptHistory, ptListExtractor, ptPageExtractor, ptImageDownloader, ptSummarizer, ptUtilities, ptWelcome, ptMetadataExtractor, ptDataTable),
    },
  });
}

export default i18n;
