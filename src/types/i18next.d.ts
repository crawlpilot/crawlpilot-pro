import 'i18next';

import type enCommon from '../i18n/locales/en/common.json';
import type enHome from '../i18n/locales/en/home.json';
import type enSettings from '../i18n/locales/en/settings.json';
import type enHistory from '../i18n/locales/en/history.json';
import type enListExtractor from '../i18n/locales/en/listExtractor.json';
import type enPageExtractor from '../i18n/locales/en/pageExtractor.json';
import type enImageDownloader from '../i18n/locales/en/imageDownloader.json';
import type enSummarizer from '../i18n/locales/en/summarizer.json';
import type enUtilities from '../i18n/locales/en/utilities.json';
import type enMetadataExtractor from '../i18n/locales/en/metadataExtractor.json';
import type enDataTable from '../i18n/locales/en/dataTable.json';
import type enTables from '../i18n/locales/en/tables.json';
import type enPageMarkdown from '../i18n/locales/en/pageMarkdown.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof enCommon;
      home: typeof enHome;
      settings: typeof enSettings;
      history: typeof enHistory;
      listExtractor: typeof enListExtractor;
      pageExtractor: typeof enPageExtractor;
      imageDownloader: typeof enImageDownloader;
      summarizer: typeof enSummarizer;
      utilities: typeof enUtilities;
      metadataExtractor: typeof enMetadataExtractor;
      dataTable: typeof enDataTable;
      tables: typeof enTables;
      pageMarkdown: typeof enPageMarkdown;
    };
  }
}
