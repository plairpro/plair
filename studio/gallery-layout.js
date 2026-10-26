/* Preserve image order and aspect ratios; choose the fullest balanced arrangement. */
function portfolioLayout(ratios, width, height, gap = 12, even = .2) {
  if (!ratios.length || width <= 0 || height <= 0) return [];
  const values = ratios.map(r => Number.isFinite(r) && r > 0 ? r : 1);
  let best = {score: -Infinity, boxes: []};
  // Evaluate horizontal rows and vertical columns using the same packing rule.
  for (const vertical of [false, true]) {
    const aspects = vertical ? values.map(r => 1 / r) : values;
    const w = vertical ? height : width, h = vertical ? width : height;
    function evaluate(groups) {
      // Similar four-frame sets keep a regular 2×2 grid or a single strip.
      if (values.length === 4 && Math.max(...values) / Math.min(...values) < 1.25 && groups.some(group => group.length !== groups[0].length)) return;
      const natural = groups.map(group => (w - gap * (group.length - 1)) / group.reduce((s, i) => s + aspects[i], 0));
      const scale = Math.min(1, (h - gap * (groups.length - 1)) / natural.reduce((s, n) => s + n, 0));
      if (scale <= 0) return;
      const boxes = [];
      let y = (h - natural.reduce((s, n) => s + n * scale, 0) - gap * (groups.length - 1)) / 2;
      groups.forEach((group, row) => {
        const rowHeight = natural[row] * scale;
        const rowWidth = group.reduce((s, i) => s + aspects[i] * rowHeight, 0) + gap * (group.length - 1);
        let x = (w - rowWidth) / 2;
        group.forEach(i => {
          const itemWidth = aspects[i] * rowHeight;
          boxes[i] = vertical ? {x:y, y:x, width:rowHeight, height:itemWidth} : {x, y, width:itemWidth, height:rowHeight};
          x += itemWidth + gap;
        });
        y += rowHeight + gap;
      });
      const areas = boxes.map(b => b.width * b.height);
      // Prefer usable image area, with a penalty for making one frame tiny.
      // `even` — how much equal frame sizes matter (higher on phones, where
      // one big frame and three thumbnails look broken).
      const score = areas.reduce((s, a) => s + a, 0) * ((1 - even) + even * Math.min(...areas) / Math.max(...areas));
      if (score > best.score + .1) best = {score, boxes};
    }
    function partition(start, groups) {
      if (start === aspects.length) { evaluate(groups); return; }
      for (let size = 1; size <= Math.min(4, aspects.length - start); size++) {
        partition(start + size, [...groups, Array.from({length:size}, (_, n) => start + n)]);
      }
    }
    // Portfolio cases normally contain 2–4 frames. Bound work for larger sets.
    if (aspects.length <= 8) partition(0, []);
    else evaluate(Array.from({length:Math.ceil(aspects.length / 3)}, (_, row) => aspects.map((_, i) => i).slice(row * 3, row * 3 + 3)));
  }
  return best.boxes;
}
if (typeof module !== 'undefined') module.exports = portfolioLayout;
