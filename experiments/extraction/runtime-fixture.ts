import { loadExtractionHarnessSeed } from "./seed/catalog.ts";

export const EXTRACTION_ORIGIN = "https://extraction.invalid";
export const RUNTIME_RESPONSES = loadExtractionHarnessSeed();

function responseBody(path: string): string {
  const response = RUNTIME_RESPONSES.get(path);
  if (!response) throw new Error(`FADENO_EXTRACTION_SEED_RESPONSE: ${path}`);
  return response.body;
}

export const DOCUMENT_HTML = responseBody("/");
export const DOCUMENT_MODULE = responseBody("/document.js");
export const HANDLER_MODULE = responseBody("/handler.js");
