// Общее изменяемое состояние движка. Импортируемые ES-байндинги read-only,
// поэтому переприсваиваемые поля движка живут как свойства одного объекта.
export const state = {
  lastPayload: null,   // отрисуем заново при ресайзе
  lastLayout: null,    // геометрия последней раскладки (для экспорта)
  noteHits: [],        // bounding box'ы нот для тап-навигации
  noteHitIndex: {},    // noteId ("m:v:i") -> bbox (playhead/подсветка)
  noteObjs: {},        // noteId -> VF.StaveNote (для отрисовки лиг Tie/Slur)
  noteTransform: {},   // noteId -> {tx, sx} горизонт. сжатие такта (для лиг)
};
