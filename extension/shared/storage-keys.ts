/**
 * Claves de `chrome.storage` compartidas entre los entrypoints de la extensión.
 *
 * Existen acá y no en cada entrypoint por un bug real: la página de opciones (A3)
 * guardaba el token de emparejamiento en `"quaPairToken"` mientras el service
 * worker (A2) lo leía de `"qua:daemon-token"`. Nunca coincidían, así que el
 * emparejamiento se completaba pero `openTransport()` fallaba siempre — y el popup
 * se tragaba el error, dejando el contador en cero sin ningún síntoma visible.
 *
 * Los tests de ambos lados pasaban porque cada uno mockeaba su propio storage. La
 * única defensa real es que la constante sea UNA SOLA. No dupliques estos valores:
 * importalos.
 */

/** Token del daemon obtenido al emparejar (§04). Lo escribe options, lo lee el SW. */
export const TOKEN_STORAGE_KEY = "qua:daemon-token";
