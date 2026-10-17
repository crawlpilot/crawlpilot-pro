/** The data table's dark ag-grid theme. */
export const GRID_CSS = `
.ag-theme-alpine {
    --ag-background-color: #020617;
    --ag-foreground-color: #E5E7EB;
    --ag-header-background-color: #0d1321;
    --ag-header-foreground-color: #CBD5E1;
    --ag-border-color: rgba(148, 163, 184, 0.18);
    --ag-row-hover-color: rgba(255, 255, 255, 0.06);
    --ag-row-border-color: rgba(148, 163, 184, 0.10);
    --ag-odd-row-background-color: #020617;
    --ag-even-row-background-color: rgba(255, 255, 255, 0.025);
    --ag-input-focus-border-color: #22D3EE;
    --ag-font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    --ag-font-size: 13px;
    --ag-header-height: 44px;
    --ag-row-height: 40px;
    --ag-selected-row-background-color: rgba(244, 208, 63, 0.10);
    --ag-cell-horizontal-padding: 12px;

    --custom-grid-border: 1px solid rgba(148, 163, 184, 0.18);
}

/* Grid Container */
.ag-root-wrapper {
    border: var(--custom-grid-border);
    border-radius: 8px;
    background-color: var(--ag-background-color);
}

/* Header Styling */
.ag-header {
    border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.01em;
    text-transform: none;
}

.ag-header-cell:hover {
    background-color: rgba(255, 255, 255, 0.04);
}

.ag-header-icon {
    color: #64748B;
}

/* Row Styling */
.ag-row {
    border-bottom-color: var(--ag-row-border-color);
    transition: background-color 0.1s ease;
}

.ag-row-selected {
    border-left: 2px solid #F4D03F !important;
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
    outline: 1px solid rgba(34, 211, 238, 0.4) !important;
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
    background-color: #334155;
    border-radius: 4px;
    border: 2px solid #020617;
}

.ag-body-viewport::-webkit-scrollbar-thumb:hover {
    background-color: #475569;
}

/* Pagination */
.ag-paging-panel {
    border-top: 1px solid rgba(148, 163, 184, 0.18);
    font-size: 12.5px;
    color: #94A3B8;
    padding: 8px 16px;
}
`;
