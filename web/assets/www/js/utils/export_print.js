// =====================================================================
//  Print / export helpers — Safari iOS uses share or Blob; desktop prints
// =====================================================================
import { el } from './dom.js';
import { needsShareExport } from './platform.js';

const PRINT_CSS = `
html, body {
  margin: 0; padding: 0; background: #ffffff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
#print-root { position: static; left: auto; }
.pf-page {
  width: 794px; height: 1123px; position: relative;
  margin: 0 auto; background: #ffffff; overflow: hidden;
  page-break-after: always; break-after: page;
}
.pf-page:last-child { page-break-after: auto; break-after: auto; }
svg { display: block; max-width: 100%; }
@media print {
  @page { size: A4; margin: 0; }
}
`;

function buildPrintHtml(title) {
    const root = el('print-root');
    if (!root) throw new Error('print-root missing');
    const pages = root.innerHTML;
    if (!pages || !String(pages).trim()) throw new Error('no print pages');
    const safeTitle = String(title || 'ScoreFlow').replace(/[<>&"]/g, '');
    return '<!DOCTYPE html><html><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<title>' + safeTitle + '</title><style>' + PRINT_CSS + '</style>'
        + '</head><body><div id="print-root">' + pages + '</div></body></html>';
}

/**
 * Export already-rendered print pages.
 * Desktop / Android: window.print() (unchanged).
 * iOS: navigator.share(File) when possible, else Blob URL in a new tab.
 * @returns {Promise<string>} 'print' | 'shared' | 'blob'
 */
export async function exportPrintPages(title) {
    if (!needsShareExport()) {
        window.print();
        return 'print';
    }

    const html = buildPrintHtml(title);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const filename = ((title || 'scoreflow').replace(/[^\w\-]+/g, '_').slice(0, 40)
        || 'scoreflow') + '.html';

    // Prefer the iOS share sheet when Files sharing is supported.
    if (navigator.share) {
        try {
            const file = new File([blob], filename, { type: 'text/html' });
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: title || 'ScoreFlow',
                });
                return 'shared';
            }
        } catch (e) {
            // AbortError = user cancelled — treat as success (no fallback spam).
            if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) {
                if (e.name === 'AbortError') return 'shared';
            }
            // Fall through to Blob tab.
        }
        // Share without files (some iOS versions).
        try {
            const url = URL.createObjectURL(blob);
            await navigator.share({
                title: title || 'ScoreFlow',
                url: url,
            });
            setTimeout(function () { URL.revokeObjectURL(url); }, 60_000);
            return 'shared';
        } catch (e) {
            if (e && e.name === 'AbortError') return 'shared';
        }
    }

    // Fallback: open printable HTML in a new tab.
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, '_blank');
    if (!opened) {
        // Popup blocked — navigate top frame as last resort.
        (window.top || window).location.href = url;
    } else {
        setTimeout(function () { URL.revokeObjectURL(url); }, 120_000);
    }
    return 'blob';
}
