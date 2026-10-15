import { startPopup } from "./main.js";

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  document.addEventListener("DOMContentLoaded", () => startPopup());
}
