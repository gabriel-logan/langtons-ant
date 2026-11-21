const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function fmtInt(n) {
  return integer.format(n);
}

export function fmtRate(stepsPerSecond) {
  if (stepsPerSecond === Infinity) {
    return 'max';
  }
  if (stepsPerSecond < 1000) {
    return `${integer.format(stepsPerSecond)}/s`;
  }
  return `${compact.format(stepsPerSecond)}/s`;
}

export function fmtZoom(pxPerCell) {
  if (pxPerCell >= 1) {
    return `${decimal.format(pxPerCell)} px/cell`;
  }
  return `${decimal.format(1 / pxPerCell)} cells/px`;
}
