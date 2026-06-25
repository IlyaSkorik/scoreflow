// Множитель реального времени ноты от tuplet-группы (normal/actual).
// 1.0 вне группы. Триоль 3:2 -> 2/3.
export function tupletScaleOf(n) {
    return (n && n.tuplet && n.tuplet.actual)
        ? n.tuplet.normal / n.tuplet.actual : 1;
}
