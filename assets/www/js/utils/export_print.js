// =====================================================================
//  Print / export — same pipeline as Android InAppWebView.printCurrentPage:
//  vector #print-root pages + system print dialog → «Save as PDF».
// =====================================================================
import { el } from './dom.js';
import { needsShareExport } from './platform.js';

const PRINT_CSS = `
html, body {
  margin: 0; padding: 0; background: #ffffff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
#print-root { position: static !important; left: auto !important; top: auto !important; }
.pf-page {
  width: 794px; height: 1123px; position: relative;
  margin: 0 auto; background: #ffffff; overflow: hidden;
  page-break-after: always; break-after: page;
}
.pf-page:last-child { page-break-after: auto; break-after: auto; }
svg { display: block; }
@media print {
  @page { size: A4; margin: 0; }
  html, body { background: #ffffff; margin: 0; padding: 0; }
  .pf-page {
    margin: 0;
    page-break-after: always;
    break-after: page;
  }
  .pf-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
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
        + '</head><body><div id="print-root">' + pages + '</div>'
        + '<script>('
        + 'function go(){try{window.focus();window.print();}catch(e){}}'
        + 'if(document.readyState==="complete")setTimeout(go,50);'
        + 'else window.addEventListener("load",function(){setTimeout(go,50);});'
        + ')</script>'
        + '</body></html>';
}

/**
 * Export already-rendered print pages.
 *
 * Same end result as Android: system print UI → Save as PDF from the vector
 * #print-root pages (no HTML file share, no JPEG raster PDF).
 *
 * Desktop / Android Chrome: window.print() in the engine frame.
 * iOS Safari: dedicated print window (iframe print is unreliable) then print().
 */
export async function exportPrintPages(title) {
    if (!needsShareExport()) {
        window.print();
        return 'print';
    }

    // iOS: print inside iframe is broken; open the same vector pages in a
    // top-level window and invoke the system print sheet (Save PDF).
    const html = buildPrintHtml(title);
    const holder = window.open('', '_blank');
    if (!holder) {
        // Popup blocked — last resort: print in place after revealing pages.
        window.print();
        return 'print';
    }
    holder.document.open();
    holder.document.write(html);
    holder.document.close();
    return 'print';
}
