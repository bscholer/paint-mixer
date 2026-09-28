// DecoArt Americana starter set. Hex values are estimates of the dried color. Calibrate them in
// the Paints tab by photographing a dried swatch of each paint.
export const DEFAULT_PAINTS = [
  { id: 'snow-white', name: 'Snow White', hex: '#f7f6f2' },
  { id: 'light-buttermilk', name: 'Light Buttermilk', hex: '#f1e9cf' },
  { id: 'slate-grey', name: 'Slate Grey', hex: '#a9b3b8' },
  { id: 'lamp-black', name: 'Lamp Black', hex: '#1b1b1d' },
  { id: 'bright-yellow', name: 'Bright Yellow', hex: '#fdd20e' },
  { id: 'bright-orange', name: 'Bright Orange', hex: '#f5731f' },
  { id: 'true-red', name: 'True Red', hex: '#d9262c' },
  { id: 'cherry-red', name: 'Cherry Red', hex: '#a8233a' },
  { id: 'royal-fuchsia', name: 'Royal Fuchsia', hex: '#c8336d' },
  { id: 'dioxazine-purple', name: 'Dioxazine Purple', hex: '#3b2667' },
  { id: 'true-blue', name: 'True Blue', hex: '#2f5e9e' },
  { id: 'turquoise', name: 'Turquoise', hex: '#74cdb9' },
  { id: 'peacock-teal', name: 'Peacock Teal', hex: '#1c978d' },
  { id: 'festive-green', name: 'Festive Green', hex: '#2e8b3a' },
  { id: 'forest-green', name: 'Forest Green', hex: '#274534' },
  { id: 'dark-chocolate', name: 'Dark Chocolate', hex: '#4e3527' },
].map((p) => ({ ...p, enabled: true }));
