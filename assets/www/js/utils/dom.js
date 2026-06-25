// [ScoreFlow engine] Вынесено из index.html без изменений логики.
export const PAD = 8; // CSS-padding контейнера (см. #notation-container)

export function el(id) { return document.getElementById(id); }

export function showError(msg) {
    const c = el('notation-container');
    let e = el('engine-error');
    if (!e) {
        e = document.createElement('div');
        e.id = 'engine-error';
        c.appendChild(e);
    }
    e.textContent = msg;
}
