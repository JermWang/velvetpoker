/**
 * `engine/` namespace alias. The implementation lives one directory up so the
 * pure modules (evaluator, rng, hand, etc.) sit together. Import from here when
 * you want to be explicit that you are using the deterministic engine core.
 */
export * from "../index";
