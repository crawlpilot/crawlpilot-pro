export class RightClickUnlocker {
    private static enabled = false;
    private static events = ['contextmenu', 'copy', 'cut', 'paste', 'selectstart', 'mousedown', 'mouseup', 'keydown', 'keyup', 'dragstart'];

    private static handler = (e: Event) => {
        e.stopPropagation();
        // Don't prevent default, just stop propagation so site scripts don't see it
        // e.preventDefault(); 
    };

    public static enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.events.forEach(event => {
            window.addEventListener(event, this.handler, true); // Capture phase
        });
        console.log('🔓 [RightClickUnlocker] Enabled');

        // Try to nuke common blocking attributes
        document.querySelectorAll('*').forEach(el => {
            if (el.getAttribute('oncontextmenu')) el.setAttribute('oncontextmenu', 'return true');
            if (el.getAttribute('onselectstart')) el.setAttribute('onselectstart', 'return true');
            if (el.getAttribute('oncreate')) el.setAttribute('oncreate', 'return true');
        });
    }

    public static disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.events.forEach(event => {
            window.removeEventListener(event, this.handler, true);
        });
        console.log('🔒 [RightClickUnlocker] Disabled');
    }

    public static isEnabled() {
        return this.enabled;
    }
}
