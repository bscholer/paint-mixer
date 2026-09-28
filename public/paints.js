// DecoArt Americana starter set. Hex values come from the DecoArt color chart (by product code).
// Real dried paint differs from the chart, so calibrate from a photo of a dried swatch.
export const DEFAULT_PAINTS = [
  { id: 'snow-white', name: 'Snow White', hex: '#ffffff' }, // DAO1
  { id: 'light-buttermilk', name: 'Light Buttermilk', hex: '#ffffda' }, // DA164
  { id: 'slate-grey', name: 'Slate Grey', hex: '#a7b0b1' }, // DAO68
  { id: 'lamp-black', name: 'Lamp Black', hex: '#000000' }, // DAO67
  { id: 'bright-yellow', name: 'Bright Yellow', hex: '#ffe500' }, // DA227
  { id: 'bright-orange', name: 'Bright Orange', hex: '#f47920' }, // DA228
  { id: 'true-red', name: 'True Red', hex: '#ab191d' }, // DA129
  { id: 'cherry-red', name: 'Cherry Red', hex: '#751c28' }, // DA159
  { id: 'royal-fuchsia', name: 'Royal Fuchsia', hex: '#a72c6d' }, // DA151
  { id: 'dioxazine-purple', name: 'Dioxazine Purple', hex: '#3a2b69' }, // DA101
  { id: 'true-blue', name: 'True Blue', hex: '#00339a' }, // DAO36
  { id: 'turquoise', name: 'Turquoise', hex: '#6db6c6' }, // DAO87
  { id: 'peacock-teal', name: 'Peacock Teal', hex: '#008a8d' }, // DA326
  { id: 'festive-green', name: 'Festive Green', hex: '#009a44' }, // DA230
  { id: 'forest-green', name: 'Forest Green', hex: '#206137' }, // DAO50
  { id: 'dark-chocolate', name: 'Dark Chocolate', hex: '#301e0a' }, // DAO65
].map((p) => ({ ...p, enabled: true }));
