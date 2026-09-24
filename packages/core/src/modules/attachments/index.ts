/** Public API of this module (ADR-0020). Other modules import only from here. */
export { AttachmentStore, SettingsStore, DEFAULT_GEMINI_MODEL } from "./store.ts";
export { extractText, officeText, geminiExtract, type ExtractOptions, type Extracted } from "./extract.ts";
