
export interface ElementEditorResult {
    action: 'extract' | 'click';
    name?: string;
    extractionType?: 'auto' | 'text' | 'image' | 'link' | 'list' | 'table';
    selector: string;
    xpath: string;
    waitTime?: number;
}

export class ElementEditorPopup {
    private overlay: HTMLElement | null = null;
    private onSaveCallback: ((result: ElementEditorResult) => void) | null = null;
    private onCancelCallback: (() => void) | null = null;

    // State
    private action: 'extract' | 'click' = 'extract';
    private extractionType: 'auto' | 'text' | 'image' | 'link' | 'list' | 'table' = 'auto';
    private name: string = '';
    private selector: string = '';
    private xpath: string = '';
    private waitTime: number = 500;

    constructor() { }

    public show(
        element: HTMLElement,
        currentSelector: string,
        currentXPath: string,
        onSave: (result: ElementEditorResult) => void,
        onCancel: () => void
    ) {
        this.selector = currentSelector;
        this.xpath = currentXPath;
        this.onSaveCallback = onSave;
        this.onCancelCallback = onCancel;

        // Default naming
        const tag = element.tagName.toLowerCase();
        this.name = `${tag}_element`;

        // Determine likely extraction type
        if (element.tagName === 'IMG') this.extractionType = 'image';
        else if (element.tagName === 'A') this.extractionType = 'link';
        else this.extractionType = 'text';

        this.createUI();
    }

    private createUI() {
        this.removeUI(); // Safety

        // Container (Shadow Host)
        const host = document.createElement('div');
        host.id = 'crawl-pilot-editor-host';
        host.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 2147483647;
            pointer-events: none;
            font-family: 'Inter', system-ui, sans-serif;
        `;
        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });

        // Styles
        const style = document.createElement('style');
        style.textContent = `
            * { box-sizing: border-box; }
            .overlay {
                position: absolute;
                inset: 0;
                background: rgba(0,0,0,0.5);
                backdrop-filter: blur(2px);
                pointer-events: auto;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .card {
                width: 420px;
                background: #020617;
                border: 1px solid #334155;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                color: #e2e8f0;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                max-height: 90vh;
            }
            .header {
                padding: 16px;
                border-bottom: 1px solid #1e293b;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: linear-gradient(to right, rgba(255,225,0,0.05), transparent);
            }
            .header h2 { margin: 0; font-size: 16px; font-weight: 600; color: #fbbf24; }
            
            .content { padding: 20px; overflow-y: auto; flex: 1; }
            
            .section { margin-bottom: 24px; }
            .section-title { font-size: 13px; font-weight: 500; color: #94a3b8; margin-bottom: 8px; }
            
            /* Tabs */
            .tabs { display: flex; gap: 12px; margin-bottom: 24px; }
            .tab-btn {
                flex: 1;
                padding: 12px;
                border: 1px solid #334155;
                background: #0f172a;
                color: #94a3b8;
                border-radius: 8px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: all 0.2s;
            }
            .tab-btn.active {
                background: #fbbf24;
                color: #0f172a;
                border-color: #fbbf24;
            }
            .tab-btn:hover:not(.active) {
                border-color: #475569;
                color: #e2e8f0;
            }

            /* Inputs */
            .input-group { margin-bottom: 16px; }
            .input {
                width: 100%;
                background: #1e293b;
                border: 1px solid #334155;
                padding: 10px 12px;
                border-radius: 6px;
                color: white;
                font-size: 13px;
                font-family: monospace;
            }
            .input:focus { outline: none; border-color: #fbbf24; }

            /* Radio Cards */
            .radio-group { display: flex; flex-direction: column; gap: 8px; }
            .radio-card {
                display: flex;
                align-items: center;
                padding: 12px;
                background: #0f172a;
                border: 1px solid #1e293b;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .radio-card:hover { border-color: #475569; }
            .radio-card.selected { border-color: #fbbf24; background: rgba(251, 191, 36, 0.05); }
            
            .radio-indicator {
                width: 16px; 
                height: 16px; 
                border-radius: 50%; 
                border: 2px solid #475569;
                margin-right: 12px;
                position: relative;
                flex-shrink: 0;
            }
            .radio-card.selected .radio-indicator { border-color: #fbbf24; }
            .radio-card.selected .radio-indicator::after {
                content: ''; position: absolute; top: 3px; left: 3px; right: 3px; bottom: 3px;
                background: #fbbf24; border-radius: 50%;
            }

            .badge {
                margin-left: auto;
                font-size: 10px;
                padding: 2px 6px;
                background: #fbbf24;
                color: #000;
                border-radius: 4px;
                font-weight: 700;
                text-transform: uppercase;
            }

            /* Footer */
            .footer {
                padding: 16px;
                border-top: 1px solid #1e293b;
                display: flex;
                gap: 12px;
            }
            .btn {
                flex: 1;
                padding: 10px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                border: none;
            }
            .btn-secondary { background: #1e293b; color: #e2e8f0; }
            .btn-secondary:hover { background: #334155; }
            .btn-primary { background: #fbbf24; color: #0f172a; }
            .btn-primary:hover { background: #f59e0b; }

            /* Scrollbars */
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

            /* Advanced Toggles */
            .advanced-btn { 
                font-size: 11px; 
                color: #fbbf24; 
                background: rgba(251, 191, 36, 0.1); 
                padding: 4px 8px; 
                border-radius: 4px; 
                border: none; 
                cursor: pointer; 
                margin-left: 8px;
            }

            .selector-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
            .selector-row { display: flex; gap: 8px; }
            .selector-label { 
                width: 50px; 
                background: #1e293b; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-size: 11px; 
                color: #94a3b8; 
                border-radius: 4px;
                border: 1px solid #334155;
            }
        `;
        shadow.appendChild(style);

        // Panel
        this.overlay = document.createElement('div');
        this.overlay.className = 'overlay';

        // --- Interactions Helpers ---
        const setExtractionType = (type: string) => {
            this.extractionType = type as any;
            render();
        };

        const setAction = (act: string) => {
            this.action = act as any;
            render();
        };

        const handleSave = () => {
            if (this.onSaveCallback) {
                this.onSaveCallback({
                    action: this.action,
                    name: (shadow.querySelector('#el-name') as HTMLInputElement).value || this.name,
                    extractionType: this.extractionType,
                    selector: (shadow.querySelector('#css-selector') as HTMLInputElement).value || this.selector,
                    xpath: (shadow.querySelector('#xpath-selector') as HTMLInputElement).value || this.xpath,
                    waitTime: parseInt((shadow.querySelector('#click-wait') as HTMLInputElement)?.value || '500')
                });
            }
            this.removeUI();
        };

        const handleCancel = () => {
            if (this.onCancelCallback) this.onCancelCallback();
            this.removeUI();
        };

        // --- Render Function ---
        const render = () => {
            // Clear current content inside overlay but keep container
            this.overlay!.innerHTML = '';

            const card = document.createElement('div');
            card.className = 'card';

            // Header
            card.innerHTML = `
                <div class="header">
                    <h2>Edit Element</h2>
                </div>
             `;

            const content = document.createElement('div');
            content.className = 'content';

            // Action Tabs
            content.innerHTML += `
                <div class="section-title">What do you want to do?</div>
                <div class="tabs">
                    <div id="tab-extract" class="tab-btn ${this.action === 'extract' ? 'active' : ''}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        Extract Data
                    </div>
                    <div id="tab-click" class="tab-btn ${this.action === 'click' ? 'active' : ''}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9l6 6-6 6"></path><path d="M4 4v5"></path><path d="M4 4h5"></path><path d="M4 4l16 16"></path></svg>
                        Click Element
                    </div>
                </div>
             `;

            // Name Input
            content.innerHTML += `
                <div class="section">
                    <div class="section-title">Element name (optional)</div>
                    <input id="el-name" class="input" type="text" value="${this.name}" placeholder="e.g. product_title">
                </div>
             `;

            // Extraction Options (Only if 'extract')
            if (this.action === 'extract') {
                content.innerHTML += `<div class="section-title">What information should we extract?</div>`;
                const radioGroup = document.createElement('div');
                radioGroup.className = 'radio-group';

                const options = [
                    { id: 'auto', label: 'Auto Extract', sub: 'Let generic logic decide', badge: 'Recommended' },
                    { id: 'text', label: 'Text Content', sub: 'Extract visible text', icon: '📝' },
                    { id: 'image', label: 'Image', sub: 'Extract image URL', icon: '🖼️' },
                    { id: 'link', label: 'Link', sub: 'Extract anchor URL', icon: '🔗' }
                ];

                options.forEach(opt => {
                    const el = document.createElement('div');
                    el.className = `radio-card ${this.extractionType === opt.id ? 'selected' : ''}`;
                    el.innerHTML = `
                        <div class="radio-indicator"></div>
                        <div>
                            <div style="font-size: 13px; font-weight: 600; color: #fff;">${opt.icon ? opt.icon + ' ' : ''}${opt.label}</div>
                            <div style="font-size: 11px; color: #64748b;">${opt.sub}</div>
                        </div>
                        ${opt.badge ? `<div class="badge">${opt.badge}</div>` : ''}
                     `;
                    el.onclick = () => setExtractionType(opt.id);
                    radioGroup.appendChild(el);
                });
                content.appendChild(radioGroup);
            } else {
                content.innerHTML += `
                    <div class="section">
                        <div class="section-title">Wait time after click (milliseconds)</div>
                        <input id="click-wait" class="input" type="number" value="${this.waitTime}" placeholder="500">
                        <p style="font-size: 10px; color: #64748b; margin-top: 6px;">Time to wait after clicking this element before continuing (default: 500ms)</p>
                    </div>
                `;
            }

            // Advanced Selectors
            content.innerHTML += `
                <div class="section" style="margin-top: 24px;">
                    <div style="display: flex; align-items: center;">
                        <div class="section-title" style="margin-bottom: 0;">Element Selectors</div>
                        <span class="advanced-btn">Advanced</span>
                    </div>
                    <div class="selector-list">
                        <div class="selector-row">
                            <div class="selector-label">CSS</div>
                            <input id="css-selector" class="input" type="text" value="${this.selector}">
                        </div>
                        <div class="selector-row">
                            <div class="selector-label">XPath</div>
                            <input id="xpath-selector" class="input" type="text" value="${this.xpath}">
                        </div>
                    </div>
                </div>
             `;

            card.appendChild(content);

            // Footer
            const footer = document.createElement('div');
            footer.className = 'footer';
            footer.innerHTML = `
                <button id="btn-cancel" class="btn btn-secondary">Cancel</button>
                <button id="btn-save" class="btn btn-primary">${this.action === 'click' ? 'Save Action' : 'Save Element'}</button>
             `;
            card.appendChild(footer);

            this.overlay!.appendChild(card);

            // Bind Events
            const tabExtract = content.querySelector('#tab-extract');
            const tabClick = content.querySelector('#tab-click');
            if (tabExtract) tabExtract.addEventListener('click', () => setAction('extract'));
            if (tabClick) tabClick.addEventListener('click', () => setAction('click'));

            const btnCancel = footer.querySelector('#btn-cancel');
            const btnSave = footer.querySelector('#btn-save');
            if (btnCancel) btnCancel.addEventListener('click', handleCancel);
            if (btnSave) btnSave.addEventListener('click', handleSave);

            // Stop propagation on card click to prevent overlay close (if enabled)
            card.addEventListener('click', (e) => e.stopPropagation());
        };

        render();
        shadow.appendChild(this.overlay);
    }

    private removeUI() {
        const host = document.getElementById('crawl-pilot-editor-host');
        if (host) host.remove();
        this.overlay = null;
    }
}
