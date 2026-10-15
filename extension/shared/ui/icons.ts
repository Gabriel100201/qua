/**
 * Íconos de línea 20×20 de QUA (diseño 2026-10, mismos trazos que en Penpot). Usan
 * `currentColor`, así toman el color del texto donde se insertan.
 */
const BODIES = {
  "anchor": "<circle cx=\"10\" cy=\"10\" r=\"6.5\"/><circle cx=\"10\" cy=\"10\" r=\"1.6\" fill=\"currentColor\"/>",
  "back": "<path d=\"M12.5 4.5L7 10l5.5 5.5\"/>",
  "bug": "<rect x=\"6\" y=\"6\" width=\"8\" height=\"10\" rx=\"4\"/><path d=\"M10 6V3.5M6 9.5H3M17 9.5h-3M6 13H3.5M16.5 13H14\"/>",
  "check": "<path d=\"M4.5 10.5l3.5 3.5 7.5-8\"/>",
  "clock": "<circle cx=\"10\" cy=\"10\" r=\"7.5\"/><path d=\"M10 6v4.5l3 1.8\"/>",
  "copy": "<rect x=\"6.5\" y=\"6.5\" width=\"10\" height=\"10\" rx=\"2\"/><path d=\"M13.5 6.5V4.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2\"/>",
  "cpu-warn": "<rect x=\"5\" y=\"5\" width=\"10\" height=\"10\" rx=\"2\"/><path d=\"M10 7.8v3M10 12.7h.01\"/>",
  "download": "<path d=\"M10 3v9.5M6 8.5l4 4 4-4M3.5 15.5v1a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1\"/>",
  "engine": "<rect x=\"5\" y=\"5\" width=\"10\" height=\"10\" rx=\"2\"/><rect x=\"8\" y=\"8\" width=\"4\" height=\"4\" rx=\"0.8\"/><path d=\"M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8h2.5M2.5 12h2.5M15 8h2.5M15 12h2.5\"/>",
  "external": "<path d=\"M11 3.5h5.5V9M16.5 3.5L9 11M14 12v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8\"/>",
  "flag": "<path d=\"M5 17.5V3M5 3.5h9l-2 3.25 2 3.25H5\"/>",
  "gear": "<path d=\"M3.5 6.5h7M14.5 6.5h2M3.5 13.5h2M9.5 13.5h7\"/><circle cx=\"12.5\" cy=\"6.5\" r=\"2\"/><circle cx=\"7.5\" cy=\"13.5\" r=\"2\"/>",
  "keyboard": "<rect x=\"2.5\" y=\"5\" width=\"15\" height=\"10\" rx=\"2\"/><path d=\"M6 8.5h.01M9 8.5h.01M12 8.5h.01M15 8.5h-.01M6.5 12h7\"/>",
  "layout": "<rect x=\"3\" y=\"3.5\" width=\"14\" height=\"13\" rx=\"2\"/><path d=\"M3 8h14M8 8v8.5\"/>",
  "lock": "<rect x=\"4.5\" y=\"9\" width=\"11\" height=\"8\" rx=\"1.8\"/><path d=\"M7 9V6.5a3 3 0 0 1 6 0V9\"/>",
  "mic": "<rect x=\"7\" y=\"2.5\" width=\"6\" height=\"10\" rx=\"3\"/><path d=\"M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5\"/>",
  "pin": "<path d=\"M7.5 3h5l-1 5 3 3H5.5l3-3zM10 11v6\"/>",
  "puzzle": "<path d=\"M8 3.5h3v2a1.3 1.3 0 0 0 2.6 0v-2h2.9v4h-2a1.3 1.3 0 0 0 0 2.6h2v6.4H3.5v-6.4h2a1.3 1.3 0 0 0 0-2.6h-2v-4H8z\"/>",
  "retry": "<path d=\"M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2\"/>",
  "shield": "<path d=\"M10 2.5l6 2.2v4.6c0 3.8-2.6 6.6-6 8.2-3.4-1.6-6-4.4-6-8.2V4.7z\"/>",
  "speaker": "<path d=\"M3.5 8v4h3l4 3.5v-11l-4 3.5z\"/><path d=\"M13.5 7.5a3.5 3.5 0 0 1 0 5\"/>",
  "stop": "<rect x=\"5.5\" y=\"5.5\" width=\"9\" height=\"9\" rx=\"1.5\"/>",
  "tab": "<rect x=\"2.5\" y=\"3.5\" width=\"15\" height=\"13\" rx=\"2\"/><path d=\"M2.5 7.5h15\"/><circle cx=\"5.2\" cy=\"5.5\" r=\"0.4\"/><circle cx=\"7.2\" cy=\"5.5\" r=\"0.4\"/>",
  "trash": "<path d=\"M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6\"/>",
  "type": "<path d=\"M4.5 5.5V4h11v1.5M10 4v12.5M8 16.5h4\"/>",
  "x": "<path d=\"M5 5l10 10M15 5L5 15\"/>",
} as const;

export type IconName = keyof typeof BODIES;

export function icon(name: IconName, size = 20): string {
  return `<svg class="qua-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BODIES[name]}</svg>`;
}
