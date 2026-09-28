// Apple Barrel starter set. Hex values are estimates from bottle photos. Calibrate them in the
// Paints tab by photographing a dried swatch of each paint.
export const DEFAULT_PAINTS = [
  { id: 'white', name: 'White', hex: '#f4f2ec' },
  { id: 'black', name: 'Black', hex: '#1e1e1e' },
  { id: 'flag-red', name: 'Flag Red', hex: '#c8102e' },
  { id: 'bright-yellow', name: 'Bright Yellow', hex: '#ffd100' },
  { id: 'orange', name: 'Orange', hex: '#f26b21' },
  { id: 'kelly-green', name: 'Kelly Green', hex: '#1e8c3a' },
  { id: 'bright-blue', name: 'Bright Blue', hex: '#0057b8' },
  { id: 'navy-blue', name: 'Navy Blue', hex: '#1f2a5c' },
  { id: 'purple', name: 'Purple', hex: '#5b2c83' },
  { id: 'hot-pink', name: 'Hot Pink', hex: '#e0457b' },
  { id: 'burnt-umber', name: 'Burnt Umber', hex: '#5a3a24' },
  { id: 'country-tan', name: 'Country Tan', hex: '#c9a57a' },
].map((p) => ({ ...p, enabled: true }));
