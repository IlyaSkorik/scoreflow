// =====================================================================
//  Print / export — desktop prints; iOS shares/opens a real PDF
// =====================================================================
import { el } from './dom.js';
import { needsShareExport } from './platform.js';
import { buildJpegPdf, dataUrlToBytes } from './pdf_jpeg.js';

const PAGE_W = 794;
const PAGE_H = 1123;
const SCALE = 2;

function loadImage(url) {
    return new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = url;
    });
}

async function rasterizePage(pageEl) {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W * SCALE;
    canvas.height = PAGE_H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(SCALE, SCALE);

    const svgs = pageEl.querySelectorAll('svg');
    if (!svgs.length) throw new Error('page has no SVG');

    // Single full-page SVG is the common VexFlow print case.
    const svg = svgs[0];
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) {
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    clone.setAttribute('width', String(PAGE_W));
    clone.setAttribute('height', String(PAGE_H));

    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
        const img = await loadImage(url);
        ctx.drawImage(img, 0, 0, PAGE_W, PAGE_H);
    } finally {
        URL.revokeObjectURL(url);
    }

    return canvas.toDataURL('image/jpeg', 0.92);
}

async function buildPdfBlob() {
    const root = el('print-root');
    if (!root) throw new Error('print-root missing');
    const pages = root.querySelectorAll('.pf-page');
    if (!pages.length) throw new Error('no print pages');

    const prev = {
        position: root.style.position,
        left: root.style.left,
        top: root.style.top,
        visibility: root.style.visibility,
        zIndex: root.style.zIndex,
    };
    root.style.position = 'fixed';
    root.style.left = '0';
    root.style.top = '0';
    root.style.visibility = 'hidden';
    root.style.zIndex = '-1';

    const jpegPages = [];
    try {
        for (let i = 0; i < pages.length; i++) {
            const dataUrl = await rasterizePage(pages[i]);
            jpegPages.push({
                bytes: dataUrlToBytes(dataUrl),
                width: PAGE_W * SCALE,
                height: PAGE_H * SCALE,
            });
        }
    } finally {
        root.style.position = prev.position;
        root.style.left = prev.left;
        root.style.top = prev.top;
        root.style.visibility = prev.visibility;
        root.style.zIndex = prev.zIndex;
    }

    return buildJpegPdf(jpegPages);
}

function safeFilename(title) {
    return ((title || 'scoreflow').replace(/[^\w\-]+/g, '_').slice(0, 40)
        || 'scoreflow') + '.pdf';
}

/**
 * Export already-rendered print pages.
 * Desktop / Android: window.print().
 * iOS: multi-page application/pdf (share sheet, or PDF tab held open during gesture).
 */
export async function exportPrintPages(title) {
    if (!needsShareExport()) {
        window.print();
        return 'print';
    }

    // Hold a browsing context synchronously so Safari still allows navigation
    // after the async PDF raster finishes (gesture would otherwise expire).
    const holder = window.open('about:blank', '_blank');
    if (holder) {
        try {
            holder.document.write(
                '<!DOCTYPE html><title>ScoreFlow</title>'
                + '<body style="font:16px sans-serif;padding:24px">Готовим PDF…</body>',
            );
            holder.document.close();
        } catch (e) { /* no-op */ }
    }

    let blob;
    try {
        blob = await buildPdfBlob();
    } catch (e) {
        if (holder) try { holder.close(); } catch (err) { /* no-op */ }
        throw e;
    }

    const filename = safeFilename(title);
    const url = URL.createObjectURL(blob);

    // Prefer the share sheet with a real PDF file when still allowed.
    if (navigator.share) {
        try {
            const file = new File([blob], filename, { type: 'application/pdf' });
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: title || 'ScoreFlow',
                });
                if (holder) try { holder.close(); } catch (err) { /* no-op */ }
                setTimeout(function () { URL.revokeObjectURL(url); }, 60_000);
                return 'shared';
            }
        } catch (e) {
            if (e && e.name === 'AbortError') {
                if (holder) try { holder.close(); } catch (err) { /* no-op */ }
                setTimeout(function () { URL.revokeObjectURL(url); }, 60_000);
                return 'shared';
            }
        }
    }

    if (holder) {
        holder.location.href = url;
    } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 120_000);
    return 'blob';
}
