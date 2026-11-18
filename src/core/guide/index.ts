/**
 * Construction et rendu du guide d'intégration Markdown — pur.
 */

export {
  buildGuideModel,
  type GuideInput,
  type GuideModel,
  type PluralCandidate,
  type MetadataCandidate,
} from './model.js';

export { buildGuide } from './render.js';
