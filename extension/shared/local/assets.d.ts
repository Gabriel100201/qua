// Vite (WXT) resuelve `?url` a la URL del asset empaquetado.
declare module "*?url" {
  const url: string;
  export default url;
}

// Variables `WXT_*` que Vite inyecta en el build (ver wxt.config.ts y los E2E).
interface ImportMetaEnv {
  readonly WXT_QUA_RAW_MIC?: string;
}
interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
