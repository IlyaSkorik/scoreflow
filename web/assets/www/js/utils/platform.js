// Platform helpers for Safari / iOS WebKit quirks (export + audio unlock).

/** True on iPhone / iPad / iPod (including iPadOS desktop UA). */
export function isIOS() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ may report as MacIntel with touch.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * Safari on iOS (not Chrome/Firefox/Edge iOS shells). Most iOS browsers are
 * WebKit under the hood; use this when Safari-specific UI is needed.
 */
export function isSafariIOS() {
    if (!isIOS()) return false;
    const ua = navigator.userAgent || '';
    // CriOS / FxiOS / EdgiOS are other browsers on iOS.
    if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua)) return false;
    return /WebKit/.test(ua) && !/Chrome/.test(ua);
}

/** Any mobile Safari / iOS WebKit environment that blocks window.print. */
export function needsShareExport() {
    return isIOS();
}
