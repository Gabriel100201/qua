/**
 * `@qua/protocol` — fuente de verdad de los tipos de QUA.
 *
 * Todo lo que cruza un límite de proceso está definido acá con Zod. `crates/qua-protocol`
 * lo espeja a mano en Rust y el test de fixtures doradas garantiza que no divergen.
 *
 * Regla: nadie modifica este paquete ni `fixtures/` fuera de la tarea F0. Si una tarea
 * necesita un cambio de contrato, lo reporta.
 */
export * from "./constants.js";
export * from "./target.js";
export * from "./event.js";
export * from "./utterance.js";
export * from "./issue.js";
export * from "./session.js";
export * from "./messages.js";
export * from "./audio-frame.js";
export * from "./fixtures.js";
