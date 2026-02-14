# Ultimate Web Scraper - React Edition

A modern Chrome extension built with React, TypeScript, and Vite for intelligent web scraping and data extraction.

## 🚀 Features

- **List Extraction** - Extract structured data from web pages
- **Email Extraction** - Find and collect email addresses
- **Image Download** - Bulk download images
- **Text Extraction** - Clean text and metadata extraction
- **Data Management** - IndexedDB storage with full CRUD operations

## 🛠️ Tech Stack

- **React 18** with TypeScript
- **Vite** - Fast bundling and HMR
- **TailwindCSS** - Utility-first CSS
- **IndexedDB** - Client-side data storage
- **Chrome Extension Manifest V3**

## 📦 Project Structure

```
src/
├── background/          # Service worker
│   └── index.ts
├── sidepanel/          # React UI
│   ├── index.tsx
│   ├── App.tsx
│   ├── pages/
│   └── components/
└── shared/             # Shared utilities
    ├── db/
    │   └── db-manager.ts
    ├── types/
    │   ├── database.ts
    │   └── messages.ts
    └── utils/
        └── messaging.ts
```

## 🔧 Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Build for production
npm run build
```

### Loading the Extension

1. Build the extension: `npm run build`
2. Open Chrome Extensions: `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist/` folder

## 📚 Architecture

### Database Schema

**tableData** - Metadata for extracted datasets
- `id` - Auto-increment primary key
- `name` - Display name
- `columns` - Array of column definitions
- `sourceUrl` - Origin URL
- `createdAt`, `updatedAt` - Timestamps

**tableRows** - Individual data rows
- `id` - Auto-increment primary key
- `tableDataId` - Foreign key to tableData
- `data` - Row data as key-value pairs
- `createdAt` - Timestamp

**automations** - Automation tasks
- `id` - Auto-increment primary key
- `type` - Automation type
- `status` - Current status
- `config` - Configuration object
- `metadata` - Additional metadata

### Messaging System

Components communicate via Chrome Extension messaging:

```typescript
// Send from sidepanel
sendToBackground({
  type: 'EXTRACTION_COMPLETE',
  payload: { data: extractionResult }
});

// Background handles and responds
onMessage(async (message) => {
  if (message.type === 'EXTRACTION_COMPLETE') {
    const id = await db.saveExtraction(message.payload.data);
    return { success: true, tableDataId: id };
  }
});
```

## 🎯 Development Roadmap

- [x] Phase 1: Project Setup
- [x] Phase 2: Core Infrastructure  
- [ ] Phase 3: Side Panel UI
- [ ] Phase 4: Extraction Tools
- [ ] Phase 5: Polish & Testing

## 📝 License

MIT# crawlpilot.github.io
# crawlpilot.github.io
# crawlpilot.github.io
