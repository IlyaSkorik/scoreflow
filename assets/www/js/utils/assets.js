// =====================================================================
//  Engine asset URL resolver (platform-aware, injected from Flutter)
// =====================================================================
//  Flutter sets `window.ScoreFlowAssetConfig.baseUrl` before sample loads.
//  Mobile: http://localhost:8080/assets/www/
//  Web:    /assets/www/

/**
 * Resolves [relativePath] (e.g. `piano/A0.mp3`) against the engine base URL.
 * Falls back to document-relative paths when config is not injected (tests).
 */
export function resolveAsset(relativePath) {
    const rel = relativePath.charAt(0) === '/' ? relativePath.slice(1) : relativePath;
    const cfg = window.ScoreFlowAssetConfig;
    if (cfg && cfg.baseUrl) {
        const base = cfg.baseUrl.endsWith('/') ? cfg.baseUrl : cfg.baseUrl + '/';
        return base + rel;
    }
    return rel;
}
