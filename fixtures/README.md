# fixtures — el contrato compartido TS ↔ Rust

Estos archivos son **el contrato**. No son datos de prueba: son la definición operativa de
qué significa que TypeScript y Rust hablen el mismo idioma.

> **Nadie modifica `fixtures/` ni `packages/protocol` fuera de la tarea F0.**
> Si tu tarea necesita un cambio de contrato, lo **reporta**. Un cambio unilateral rompe en
> silencio a las otras siete tareas que corren en paralelo.

## Qué hay acá

| Archivo | Qué es |
|---|---|
| `session-minimal.json` | Sesión corta de 2 issues sobre `portfolio-2026`. El caso feliz mínimo. |
| `session-full.json` | Sesión sobre Agendi que cubre **los 18 tipos de evento** de §03 y **las 3 clases de anchor** de §07. |
| `messages/*.json` | Un ejemplo de cada mensaje de §04, en las dos direcciones, más los tres cuerpos HTTP (`/pair`, `/health`). |
| `audio-frame.bin` + `.json` | Frame binario dorado de §04: 653 bytes, magic `0xA0`, 320 muestras. El `.json` describe qué tiene que salir al decodificarlo. |
| `schema/*.schema.json` | JSON Schema generados desde Zod con `pnpm gen:schema`. **Generados, no editados a mano.** |

## Los dos tests que definen "listo"

Los dos recorren la misma lista de fixtures y hacen lo mismo: parsear al tipo fuerte,
volver a serializar y exigir igualdad.

```bash
pnpm test                        # packages/protocol/test/fixtures.test.ts
~/.cargo/bin/cargo test --workspace   # crates/qua-protocol/tests/fixtures.rs
```

Si un lenguaje acepta algo que el otro no, uno de los dos falla. Es el único mecanismo que
impide que el espejo Rust —escrito a mano— se despegue de la fuente de verdad en Zod.

El manifiesto de fixtures está en dos lados (`packages/protocol/src/fixtures.ts` y el
`MANIFEST` de `crates/qua-protocol/tests/fixtures.rs`) y hay un test que compara el
manifiesto contra el contenido real del directorio: agregar una fixture y olvidarse de un
manifiesto rompe el build. Ver D-06 en `docs/DECISIONS.md`.

## Cómo agregar una fixture (solo F0)

1. Escribí el `.json`.
2. Agregalo a los **dos** manifiestos.
3. `pnpm test && ~/.cargo/bin/cargo test --workspace`.
