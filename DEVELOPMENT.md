# Ultimate Web Scraper - Development Guide

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Build for production
npm run build

# Load extension in Chrome
# 1. Build first: npm run build
# 2. Go to chrome://extensions
# 3. Enable "Developer mode"
# 4. Click "Load unpacked"
# 5. Select the dist/ folder
```

## 📁 Project Structure

```
src/
├── background/              # Background service worker
│   └── index.ts
├── sidepanel/              # React UI application
│   ├── index.tsx           # Entry point
│   ├── App.tsx             # Router
│   ├── pages/              # Page components
│   ├── components/         # Reusable components
│   └── hooks/              # Custom React hooks
└── shared/                 # Shared code
    ├── db/                 # IndexedDB manager
    ├── types/              # TypeScript types
    └── utils/              # Utilities
```

## 🔧 Development Workflow

### Making Changes

1. **Edit source files** in `src/`
2. **Run build**: `npm run build`
3. **Reload extension** in Chrome Extensions page
4. **Test changes** in the side panel

### Adding New Pages

1. Create page component in `src/sidepanel/pages/`
2. Add route in `src/sidepanel/App.tsx`
3. Add navigation from HomePage

Example:
```typescript
// src/sidepanel/pages/NewPage.tsx
export default function NewPage({ onBack }) {
  return (
    <div className="p-6">
      <button onClick={onBack}>Back</button>
      {/* Your content */}
    </div>
  );
}

// In App.tsx
case 'new-page':
  return <NewPage onBack={() => setView('home')} />;
```

### Adding Database Methods

Edit `src/shared/db/db-manager.ts`:

```typescript
async getCustomData(id: number): Promise<CustomData | null> {
  await this.ensureConnection();
  // Your IndexedDB code
}
```

## 🎨 Styling

We use **TailwindCSS** for styling. Common patterns:

```tsx
// Buttons
<button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg">

// Cards
<div className="bg-gray-800 rounded-lg p-6 border border-gray-700">

// Text
<h1 className="text-2xl font-bold">
<p className="text-gray-400">
```

## 🔌 Extension APIs

### Chrome APIs Available

- `chrome.tabs` - Tab management
- `chrome.runtime` - Messaging
- `chrome.storage` - Storage
- `chrome.sidePanel` - Side panel control
- `chrome.scripting` - Script injection

### Messaging Example

```typescript
// Send from sidepanel to background
import { sendToBackground } from '@/shared/utils/messaging';

const response = await sendToBackground({
  type: 'EXTRACTION_COMPLETE',
  payload: { data: extractionData }
});

// Handle in background (src/background/index.ts)
onMessage(async (message) => {
  if (message.type === 'EXTRACTION_COMPLETE') {
    // Handle message
    return { success: true };
  }
});
```

## 🐛 Debugging

### Console Logs

- **Background**: Right-click extension icon → "Inspect service worker"
- **Side Panel**: Open side panel → Right-click → "Inspect"

### Common Issues

**Extension doesn't load:**
- Check `manifest.json` is valid
- Ensure all imports are correct
- Run `npm run build` first

**Data not saving:**
- Check background console for errors
- Verify `db.init()` completed
- Check IndexedDB in DevTools → Application

**UI not updating:**
- Clear browser cache
- Reload extension
- Check React DevTools

## 📦 Building for Production

```bash
npm run build
```

This creates optimized bundles in `dist/`:
- `sidepanel.js` - React UI (~214KB)
- `index.ts.js` - Background worker (~5KB)
- `manifest.json` - Extension manifest

## 🧪 Testing

### Manual Testing Checklist

- [ ] Extension loads without errors
- [ ] Side panel opens
- [ ] HomePage displays all tools
- [ ] List Extractor demo works
- [ ] Data saves to IndexedDB
- [ ] Data Table displays saved data
- [ ] CSV export works
- [ ] Navigation works between all pages

### Testing Data Flow

1. **Create**: Run demo extraction
2. **Save**: Check background console for "Data saved"
3. **Read**: View in Data Table
4. **Export**: Download CSV

## 📚 TypeScript Types

All types are in `src/shared/types/`:

- `database.ts` - Data models
- `messages.ts` - Message types

Example usage:
```typescript
import type { TableData, TableRow } from '@/shared/types/database';

const data: TableData = {
  name: 'My Dataset',
  columns: [...],
  sourceUrl: '...',
  createdAt: Date.now(),
  updatedAt: Date.now()
};
```

## 🚧 Adding Real Extraction

To add actual web page extraction:

1. **Create content script** (e.g., `src/content/extractor.ts`)
2. **Inject into pages** via `chrome.scripting.executeScript`
3. **Extract data** using DOM APIs
4. **Send to background** via messaging
5. **Save to database** in background worker

## 📖 Resources

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [React Docs](https://react.dev/)
- [TailwindCSS Docs](https://tailwindcss.com/)
- [Vite Docs](https://vitejs.dev/)

---

**Need help?** Check the walkthrough.md for architecture overview!
