// Injected into every HTML response served through a path-based tunnel.
// Makes an SPA that assumes it lives at the origin root ("/") work even though
// its real URL is actually "/<app-name>/...".
//
// What the shim does, all client-side:
//   1. Reads of location.pathname / location.href strip the "/<name>" prefix,
//      so the SPA's client router sees "/login" instead of "/vapt/login".
//   2. history.pushState / replaceState / assign / replace / href writes get
//      the prefix added back on, so the browser URL stays truthful.
//   3. fetch("/api/foo") and XMLHttpRequest.open get the prefix prepended, so
//      requests reach the tunneled app rather than the public server.
//
// Caveats:
//   - Only strings beginning with "/" are rewritten. Full URLs with origin or
//     relative URLs are left alone.
//   - The shim must run before any SPA code reads location, which is why we
//     inject it as the first child of <head>.

export function htmlShim(tunnelName: string): string {
  const prefix = `/t/${tunnelName}`;
  // Inline JSON-encoded string so quoting is safe.
  const p = JSON.stringify(prefix);
  const js = `
(function(){
  var P = ${p};
  var orig = {
    pathname: Object.getOwnPropertyDescriptor(Location.prototype, "pathname"),
    href:     Object.getOwnPropertyDescriptor(Location.prototype, "href"),
    pushState:    history.pushState.bind(history),
    replaceState: history.replaceState.bind(history),
    fetch:        window.fetch ? window.fetch.bind(window) : null,
    xhrOpen:      XMLHttpRequest.prototype.open
  };
  function strip(p0){
    if (!p0) return p0;
    if (p0 === P) return "/";
    if (p0.indexOf(P + "/") === 0) return p0.slice(P.length);
    return p0;
  }
  function add(u){
    if (typeof u !== "string") return u;
    if (u.indexOf("/") !== 0) return u;        // relative or protocol-relative
    if (u.indexOf("//") === 0) return u;       // protocol-relative
    if (u === P || u.indexOf(P + "/") === 0) return u;
    return P + u;
  }
  Object.defineProperty(Location.prototype, "pathname", {
    configurable: true,
    get: function(){ return strip(orig.pathname.get.call(this)); },
    set: function(v){ orig.pathname.set.call(this, add(v)); }
  });
  Object.defineProperty(Location.prototype, "href", {
    configurable: true,
    get: function(){
      var h = orig.href.get.call(this);
      var o = location.origin;
      if (h.indexOf(o + P + "/") === 0) return o + h.slice((o + P).length);
      if (h === o + P) return o + "/";
      return h;
    },
    set: function(v){ orig.href.set.call(this, typeof v === "string" ? add(v) : v); }
  });
  history.pushState    = function(s, t, u){ return orig.pushState(s, t, add(u)); };
  history.replaceState = function(s, t, u){ return orig.replaceState(s, t, add(u)); };
  if (orig.fetch) {
    window.fetch = function(input, init){
      if (typeof input === "string") input = add(input);
      else if (input && typeof input === "object" && typeof input.url === "string") {
        try { input = new Request(add(input.url), input); } catch(_) {}
      }
      return orig.fetch(input, init);
    };
  }
  XMLHttpRequest.prototype.open = function(method, url){
    if (typeof url === "string") url = add(url);
    arguments[1] = url;
    return orig.xhrOpen.apply(this, arguments);
  };
  // Also patch the WebSocket constructor so terminal connections to "/ws"
  // actually land on "/t/<name>/ws" on the gateway.
  var origWS = window.WebSocket;
  if (origWS) {
    function PatchedWS(url, protocols){
      if (typeof url === "string") {
        if (url.indexOf("ws://") === 0 || url.indexOf("wss://") === 0) {
          try {
            var u = new URL(url);
            var newPath = add(u.pathname);
            if (newPath !== u.pathname) {
              u.pathname = newPath;
              url = u.toString();
            }
          } catch(_) {}
        } else if (url.indexOf("/") === 0 && url.indexOf("//") !== 0) {
          url = add(url);
        }
      }
      return protocols === undefined ? new origWS(url) : new origWS(url, protocols);
    }
    PatchedWS.prototype = origWS.prototype;
    PatchedWS.CONNECTING = origWS.CONNECTING;
    PatchedWS.OPEN       = origWS.OPEN;
    PatchedWS.CLOSING    = origWS.CLOSING;
    PatchedWS.CLOSED     = origWS.CLOSED;
    window.WebSocket = PatchedWS;
  }
})();`.trim();
  return `<script data-flippy-shim>${js}</script>`;
}

/**
 * Inject the shim as the first <head> child, if the response is HTML.
 * If no <head> is found, prepend the whole document.
 */
export function injectShim(html: string, tunnelName: string): string {
  const shim = htmlShim(tunnelName);
  const headOpen = html.search(/<head\b[^>]*>/i);
  if (headOpen === -1) return shim + html;
  const insertAt = headOpen + (html.match(/<head\b[^>]*>/i)?.[0]?.length ?? 6);
  return html.slice(0, insertAt) + shim + html.slice(insertAt);
}
