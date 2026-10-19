/** The data table's ag-grid theme, on the panel's colour variables (light or dark). */
export const GRID_CSS = `
.ag-theme-alpine {
    --ag-background-color: var(--cp-surface);
    --ag-foreground-color: var(--cp-text);
    --ag-header-background-color: var(--cp-surface-2);
    --ag-header-foreground-color: var(--cp-text-2);
    --ag-border-color: var(--cp-line);
    --ag-row-hover-color: rgb(var(--cp-ink-rgb) / 0.06);
    --ag-row-border-color: rgb(var(--cp-ink-rgb) / 0.10);
    --ag-odd-row-background-color: var(--cp-surface);
    --ag-even-row-background-color: rgb(var(--cp-ink-rgb) / 0.025);
    --ag-input-focus-border-color: var(--cp-line-strong);
    --ag-checkbox-checked-color: var(--cp-text);
    --ag-font-family: 'Geist Variable', -apple-system, BlinkMacSystemFont, sans-serif;
    --ag-font-size: 13px;
    --ag-header-height: 44px;
    --ag-row-height: 40px;
    --ag-selected-row-background-color: rgb(var(--cp-brand-rgb) / 0.25);
    --ag-cell-horizontal-padding: 12px;

    --custom-grid-border: 1px solid rgb(var(--cp-ink-rgb) / 0.18);
}

/* Grid Container: the wrapper around it has the border and corners. */
.ag-root-wrapper {
    border: none;
    border-radius: 0;
    background-color: var(--ag-background-color);
}

/* Header Styling */
.ag-header {
    border-bottom: 1px solid var(--cp-line);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-transform: none;
}

.ag-header-cell:hover {
    background-color: rgb(var(--cp-ink-rgb) / 0.04);
}

.ag-header-icon {
    color: var(--cp-text-3);
}

/* Row Styling */
.ag-row {
    border-bottom-color: var(--ag-row-border-color);
    transition: background-color 0.1s ease;
}

.ag-row-selected {
    box-shadow: inset 3px 0 0 var(--cp-brand);
}

/* Cell Styling */
.ag-cell {
    line-height: 1.5;
    display: flex;
    align-items: center;
    overflow: hidden !important;
}

.ag-cell-focus {
    border: none !important;
    outline: 1.5px solid var(--cp-line-strong) !important;
    outline-offset: -1px;
    z-index: 10;
}

/* Scrollbars */
.ag-body-viewport::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

.ag-body-viewport::-webkit-scrollbar-track {
    background: transparent;
}

.ag-body-viewport::-webkit-scrollbar-thumb {
    background-color: rgb(var(--cp-ink-rgb) / 0.18);
    border-radius: 4px;
    border: 2px solid var(--cp-surface);
}

.ag-body-viewport::-webkit-scrollbar-thumb:hover {
    background-color: rgb(var(--cp-ink-rgb) / 0.3);
}

/* Pagination */
.ag-paging-panel {
    border-top: 1px solid var(--cp-line);
    font-size: 12.5px;
    color: var(--cp-text-2);
    padding: 8px 16px;
}
`;
