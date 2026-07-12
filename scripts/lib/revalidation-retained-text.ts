export function assertSafeRetainedText(text: string, sensitiveValues: readonly string[]): void {
  const secretPatterns = [
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/u,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|session(?:id|_id|[-_ ]?token)?)\s*[:=]\s*\S+/iu,
    /["'](?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|passwd|session(?:id|_id|[-_ ]?token)?)["']\s*:\s*["'][^"']+["']/iu,
  ];
  if (sensitiveValues.some((value) => value.length > 0 && text.includes(value)) || secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error("FADENO_REVALIDATION_RETAINED_SECRET");
  }
}
