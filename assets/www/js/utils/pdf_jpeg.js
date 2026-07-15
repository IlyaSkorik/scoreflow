// =====================================================================
//  Minimal multi-page PDF writer (JPEG images, A4)
// =====================================================================

/**
 * Build a PDF Blob from JPEG byte arrays (one per page).
 * @param {Array<{bytes: Uint8Array, width: number, height: number}>} pages
 * @returns {Blob}
 */
export function buildJpegPdf(pages) {
    if (!pages || !pages.length) throw new Error('no PDF pages');

    // A4 in PDF points (1/72").
    const pageW = 595.28;
    const pageH = 841.89;

    const objs = [];
    const offsets = [];

    function addObj(body) {
        objs.push(body);
        return objs.length; // 1-based object id
    }

    const pageIds = [];

    for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const imgId = addObj(
            '<< /Type /XObject /Subtype /Image /Width ' + p.width
            + ' /Height ' + p.height
            + ' /ColorSpace /DeviceRGB /BitsPerComponent 8'
            + ' /Filter /DCTDecode /Length ' + p.bytes.length + ' >>\nstream\n',
        );
        objs[imgId - 1] = { header: objs[imgId - 1], binary: p.bytes };

        const content = 'q\n' + pageW + ' 0 0 ' + pageH + ' 0 0 cm\n'
            + '/Im' + i + ' Do\nQ\n';
        const contentId = addObj(
            '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream',
        );
        const pageId = addObj(
            '<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + ']'
            + ' /Contents ' + contentId + ' 0 R'
            + ' /Resources << /XObject << /Im' + i + ' ' + imgId + ' 0 R >> >> >>',
        );
        pageIds.push(pageId);
    }

    const kids = pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
    const pagesId = addObj(
        '<< /Type /Pages /Kids [ ' + kids + ' ] /Count ' + pageIds.length + ' >>',
    );

    for (let i = 0; i < pageIds.length; i++) {
        const idx = pageIds[i] - 1;
        objs[idx] = objs[idx].replace('/Parent 0 0 R', '/Parent ' + pagesId + ' 0 R');
    }

    const catalogId = addObj('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');

    const encoder = new TextEncoder();
    const parts = [];
    parts.push(encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

    let offset = 0;
    for (let i = 0; i < parts.length; i++) offset += parts[i].length;

    for (let i = 0; i < objs.length; i++) {
        offsets.push(offset);
        const objNum = i + 1;
        const head = encoder.encode(objNum + ' 0 obj\n');
        parts.push(head);
        offset += head.length;

        const o = objs[i];
        if (o && o.binary) {
            const hdr = encoder.encode(o.header);
            const mid = encoder.encode('\n');
            const end = encoder.encode('\nendstream\nendobj\n');
            parts.push(hdr);
            parts.push(o.binary);
            parts.push(mid);
            parts.push(end);
            offset += hdr.length + o.binary.length + mid.length + end.length;
        } else {
            const body = encoder.encode(String(o) + '\nendobj\n');
            parts.push(body);
            offset += body.length;
        }
    }

    const xrefStart = offset;
    let xref = 'xref\n0 ' + (objs.length + 1) + '\n';
    xref += '0000000000 65535 f \n';
    for (let i = 0; i < offsets.length; i++) {
        xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += 'trailer\n<< /Size ' + (objs.length + 1)
        + ' /Root ' + catalogId + ' 0 R >>\n';
    xref += 'startxref\n' + xrefStart + '\n%%EOF\n';
    parts.push(encoder.encode(xref));

    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
        out.set(parts[i], pos);
        pos += parts[i].length;
    }
    return new Blob([out], { type: 'application/pdf' });
}

/** Decode a data URL (image/jpeg) to Uint8Array. */
export function dataUrlToBytes(dataUrl) {
    const i = dataUrl.indexOf(',');
    const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
    return bytes;
}
