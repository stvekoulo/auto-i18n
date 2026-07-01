/**
 * Core — logique pure d'auto-i18n.
 *
 * Aucun module de ce dossier ne lit/écrit sur le disque ni n'appelle le réseau.
 * Les effets de bord vivent dans `src/adapters`.
 */

export * from './types.js';
export * from './filters/index.js';
export * from './keys/index.js';
export * from './catalog/index.js';
export * from './extraction/index.js';
export * from './scan/index.js';
export * from './check/index.js';
export * from './guide/index.js';
export * from './write/index.js';
