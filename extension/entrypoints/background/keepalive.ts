import { browser } from "wxt/browser";

/**
 * Keepalive (§5.3): el tráfico del WS (audio a 50 fps) ya resetea el timer de 30 s
 * del service worker. Como red de seguridad, `chrome.alarms` cada 25 s — un alarm
 * es de las pocas cosas que despiertan un service worker MV3 dormido.
 */
export const KEEPALIVE_ALARM_NAME = "qua:keepalive";
export const KEEPALIVE_PERIOD_MINUTES = 25 / 60;

export function startKeepalive(onTick: () => void): void {
  browser.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: KEEPALIVE_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === KEEPALIVE_ALARM_NAME) onTick();
  });
}

export function stopKeepalive(): void {
  void browser.alarms.clear(KEEPALIVE_ALARM_NAME);
}
