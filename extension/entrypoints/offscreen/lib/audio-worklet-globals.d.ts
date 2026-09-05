/**
 * Tipos mínimos de `AudioWorkletGlobalScope` (§5.4) — no vienen en `lib.dom` de
 * TypeScript. Sin `import`/`export`: es un script ambiente, así que estos
 * declaran globales de verdad, visibles para `pcm-tap-processor.ts` sin
 * importar nada.
 *
 * G1 (D-G1-07): estas declaraciones vivían inline en `pcm-tap-processor.ts`
 * (`declare class`/`declare function`), pero ese archivo tiene que ser un
 * entrypoint de WXT de nivel superior para que se compile — y el análisis
 * estático de WXT (`@babel/parser`, sin el plugin de TypeScript) no entiende
 * `declare` y tira "Missing semicolon" al escanearlo. Separarlas en un `.d.ts`
 * dos niveles bajo `entrypoints/` (no matchea el glob de entrypoints de WXT)
 * saca esa sintaxis del archivo que WXT escanea.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;
