/*
 * CrawlPilot run tabs — a hidden tab that behaves like a visible one (runs in the page's MAIN world at
 * document_start, registered only during a run in background tabs, only for the run's
 * hosts, and only acting in a tab that starts hidden: the run's background tabs, not the user's).
 *
 * Chrome stops requestAnimationFrame in hidden tabs and throttles their timers, so an accordion or a
 * tab panel that animates open (React, CSS-in-JS, animation libraries) never finishes, and pages that
 * pause on `visibilitychange` don't load their sections. Here:
 *   - the page is told it is visible and focused;
 *   - requestAnimationFrame runs: a frame at once (a MessageChannel task, not throttled) when 16 ms
 *     have passed since the last, otherwise on a timer (about once a second when hidden), and on every
 *     tick of a CrawlPilot wait (`crawlpilot:frame`, about 10 a second). Animations driven by elapsed
 *     time end on their next frame; nothing spins.
 */
(function () {
    if (window.__crawlpilotVisible || document.visibilityState !== 'hidden') return;
    Object.defineProperty(window, '__crawlpilotVisible', { value: true, enumerable: false });

    var docProto = Document.prototype;
    try {
        Object.defineProperty(docProto, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
        Object.defineProperty(docProto, 'hidden', { configurable: true, get: function () { return false; } });
        Object.defineProperty(docProto, 'webkitVisibilityState', { configurable: true, get: function () { return 'visible'; } });
        Object.defineProperty(docProto, 'webkitHidden', { configurable: true, get: function () { return false; } });
        docProto.hasFocus = function () { return true; };
    } catch (e) { /* leave the page as it is */ }

    var swallow = function (e) { e.stopImmediatePropagation(); };
    document.addEventListener('visibilitychange', swallow, true);
    document.addEventListener('webkitvisibilitychange', swallow, true);
    window.addEventListener('blur', swallow, true);

    var FRAME_MS = 16;
    var callbacks = new Map();
    var nextId = 1;
    var last = 0;
    var pending = false;
    var channel = new MessageChannel();

    function frame() {
        pending = false;
        if (callbacks.size === 0) return;
        var now = performance.now();
        last = now;
        var run = Array.from(callbacks.values());
        callbacks.clear();
        for (var i = 0; i < run.length; i++) {
            try { run[i](now); } catch (err) { setTimeout(function () { throw err; }); }
        }
    }
    channel.port1.onmessage = frame;

    function schedule() {
        if (pending) return;
        pending = true;
        var wait = FRAME_MS - (performance.now() - last);
        if (wait <= 0) channel.port2.postMessage(0);
        else setTimeout(frame, wait);
    }

    window.requestAnimationFrame = function (cb) {
        var id = nextId++;
        callbacks.set(id, cb);
        schedule();
        return id;
    };
    window.cancelAnimationFrame = function (id) { callbacks.delete(id); };

    // CrawlPilot's waits tick on the service worker's clock (not throttled) and run a frame on each
    // tick, so an animation advances in real time while a run waits for it to finish.
    document.addEventListener('crawlpilot:frame', function () { if (callbacks.size) frame(); });
})();
