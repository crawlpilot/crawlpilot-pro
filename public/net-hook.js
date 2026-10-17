/*
 * CrawlPilot API Finder — page hook (runs in the page's MAIN world, only while the user records).
 * Wraps fetch and XMLHttpRequest to keep a copy of JSON responses so the user can find which API call
 * holds the data they see. Keeps everything in this tab's memory; nothing is sent anywhere. The
 * content script asks for the buffer with window.postMessage.
 */
(function () {
    if (window.__crawlpilotNetHook) return;
    Object.defineProperty(window, '__crawlpilotNetHook', { value: true, enumerable: false });
    // Visible to the content script (isolated world): lets it skip asking when no hook is recording.
    try { document.documentElement.setAttribute('data-crawlpilot-net', ''); } catch (e) { /* no document yet */ }

    var MAX_ENTRIES = 300;
    var MAX_BODY = 2000000;
    var MAX_REQ_BODY = 100000;
    var MAX_TOTAL = 40000000;
    var entries = [];
    var total = 0;
    var seq = 0;

    function looksJson(text) {
        return typeof text === 'string' && /^\s*[\[{]/.test(text);
    }

    function absolute(url) {
        try { return new URL(url, location.href).href; } catch (e) { return String(url); }
    }

    function bodyToString(b) {
        if (b == null) return undefined;
        try {
            if (typeof b === 'string') return b.slice(0, MAX_REQ_BODY);
            if (b instanceof URLSearchParams) return b.toString().slice(0, MAX_REQ_BODY);
            if (typeof FormData !== 'undefined' && b instanceof FormData) {
                var parts = [];
                b.forEach(function (v, k) { parts.push(encodeURIComponent(k) + '=' + (typeof v === 'string' ? encodeURIComponent(v) : '[file]')); });
                return parts.join('&');
            }
        } catch (e) { /* fall through */ }
        return '[binary body]';
    }

    function headersToObject(h) {
        var out = {};
        if (!h) return out;
        try { new Headers(h).forEach(function (v, k) { out[k] = v; }); } catch (e) { /* ignore */ }
        return out;
    }

    function record(e) {
        var len = e.responseText.length;
        entries.push(e);
        total += len;
        while (entries.length > MAX_ENTRIES || total > MAX_TOTAL) {
            var old = entries.shift();
            total -= old.responseText.length;
        }
    }

    function capture(via, url, method, status, contentType, reqHeaders, reqBody, text) {
        if (!looksJson(text)) return;
        if (contentType && !/json|javascript|text\/plain|text\/html/i.test(contentType)) return;
        record({
            seq: ++seq,
            url: absolute(url),
            method: (method || 'GET').toUpperCase(),
            status: status,
            contentType: contentType || '',
            requestHeaders: reqHeaders || {},
            requestBody: reqBody,
            responseText: text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text,
            size: text.length,
            truncated: text.length > MAX_BODY,
            at: Date.now(),
            via: via
        });
    }

    // --- fetch ---
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
            var url, method, headers, body;
            try {
                var req = (typeof Request !== 'undefined' && input instanceof Request) ? input : null;
                url = req ? req.url : String(input);
                method = (init && init.method) || (req && req.method) || 'GET';
                headers = headersToObject((init && init.headers) || (req && req.headers));
                body = bodyToString(init && init.body);
            } catch (e) { /* ignore */ }
            var p = origFetch.apply(this, arguments);
            p.then(function (res) {
                try {
                    var ct = res.headers.get('content-type') || '';
                    if (ct && !/json|javascript|text/i.test(ct)) return;
                    res.clone().text().then(function (text) {
                        capture('fetch', url, method, res.status, ct, headers, body, text);
                    }).catch(function () { /* body unreadable */ });
                } catch (e) { /* ignore */ }
            }).catch(function () { /* request failed: nothing to keep */ });
            return p;
        };
    }

    // --- XMLHttpRequest ---
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
        var origOpen = XHR.prototype.open;
        var origSend = XHR.prototype.send;
        var origSetHeader = XHR.prototype.setRequestHeader;
        XHR.prototype.open = function (method, url) {
            this.__cp = { method: method, url: url, headers: {} };
            return origOpen.apply(this, arguments);
        };
        XHR.prototype.setRequestHeader = function (k, v) {
            if (this.__cp) this.__cp.headers[String(k).toLowerCase()] = String(v);
            return origSetHeader.apply(this, arguments);
        };
        XHR.prototype.send = function (body) {
            var xhr = this;
            if (xhr.__cp) {
                xhr.__cp.body = bodyToString(body);
                xhr.addEventListener('loadend', function () {
                    try {
                        var text;
                        if (xhr.responseType === '' || xhr.responseType === 'text') text = xhr.responseText;
                        else if (xhr.responseType === 'json') text = JSON.stringify(xhr.response);
                        else return;
                        capture('xhr', xhr.__cp.url, xhr.__cp.method, xhr.status, xhr.getResponseHeader('content-type') || '', xhr.__cp.headers, xhr.__cp.body, text);
                    } catch (e) { /* ignore */ }
                });
            }
            return origSend.apply(this, arguments);
        };
    }

    // --- relay to the content script ---
    window.addEventListener('message', function (ev) {
        if (ev.source !== window || !ev.data) return;
        var d = ev.data;
        if (d.source === 'crawlpilot-net-req') {
            var list = d.since ? entries.filter(function (e) { return e.seq > d.since; }) : entries;
            window.postMessage({ source: 'crawlpilot-net-res', id: d.id, entries: list }, location.origin === 'null' ? '*' : location.origin);
        } else if (d.source === 'crawlpilot-net-clear') {
            entries = [];
            total = 0;
        }
    });
})();
