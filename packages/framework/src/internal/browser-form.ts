const generatedActionPrefix = "/.fadeno/actions/v1/";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type PrivateFormSubmitter = HTMLButtonElement | HTMLInputElement;

export type PrivateFormEligibility = Readonly<{
  kind: "navigation" | "mutation";
  form: HTMLFormElement;
  submitter?: PrivateFormSubmitter;
  destination: URL;
  encoding: "application/x-www-form-urlencoded" | "multipart/form-data";
}>;

export type PrivateFormRequest = Readonly<{
  destination: URL;
  body?: FormData | URLSearchParams;
}>;

function targetOwnsCurrentContext(target: string): boolean {
  if (target === "") return true;
  const keyword = target.toLowerCase();
  if (keyword === "_self") return true;
  if (keyword === "_parent") return globalThis.parent === globalThis.window;
  if (keyword === "_top") return globalThis.top === globalThis.window;
  if (keyword === "_blank") return false;
  return target === globalThis.window.name;
}

function effectiveAttribute(
  submitter: PrivateFormSubmitter | undefined,
  submitterAttribute: "formaction" | "formmethod" | "formenctype" | "formtarget",
  submitterValue: () => string,
  formValue: () => string,
): string {
  return submitter?.hasAttribute(submitterAttribute) ? submitterValue() : formValue();
}

function validSubmitter(form: HTMLFormElement, value: SubmitEvent["submitter"]): PrivateFormSubmitter | undefined | false {
  if (value === null) return undefined;
  if (!(value instanceof HTMLButtonElement || value instanceof HTMLInputElement) || value.form !== form) return false;
  if (value instanceof HTMLButtonElement) return value.type === "submit" ? value : false;
  return value.type === "submit" ? value : false;
}

function safeDestination(value: string): URL | undefined {
  let destination: URL;
  try { destination = new URL(value, location.href); }
  catch { return undefined; }
  const current = new URL(location.href);
  const trustworthy = current.protocol === "https:"
    || (current.protocol === "http:" && loopbackHosts.has(current.hostname));
  if (!trustworthy
    || destination.protocol !== current.protocol
    || destination.origin !== current.origin
    || destination.username !== ""
    || destination.password !== ""
    || destination.hash !== "") return undefined;
  return destination;
}

export function privateFormEligibility(
  form: HTMLFormElement,
  candidate: SubmitEvent["submitter"],
): PrivateFormEligibility | undefined {
  if (!form.isConnected || form.ownerDocument !== document) return undefined;
  if (form.relList.contains("noreferrer")) return undefined;
  const submitter = validSubmitter(form, candidate);
  if (submitter === false) return undefined;
  const method = effectiveAttribute(
    submitter,
    "formmethod",
    () => submitter?.formMethod ?? "",
    () => form.method,
  ).toLowerCase();
  if (method !== "get" && method !== "post") return undefined;
  const target = effectiveAttribute(
    submitter,
    "formtarget",
    () => submitter?.formTarget ?? "",
    () => form.target,
  );
  if (!targetOwnsCurrentContext(target)) return undefined;
  const destination = safeDestination(effectiveAttribute(
    submitter,
    "formaction",
    () => submitter?.formAction ?? "",
    () => form.action,
  ));
  if (!destination) return undefined;
  const encoding = effectiveAttribute(
    submitter,
    "formenctype",
    () => submitter?.formEnctype ?? "",
    () => form.enctype,
  ).toLowerCase();
  if (encoding !== "application/x-www-form-urlencoded" && encoding !== "multipart/form-data") return undefined;
  if (method === "post" && (destination.protocol !== "https:" || !destination.pathname.startsWith(generatedActionPrefix))) {
    return undefined;
  }
  return Object.freeze({
    kind: method === "get" ? "navigation" : "mutation",
    form,
    ...(submitter === undefined ? {} : { submitter }),
    destination,
    encoding,
  });
}

function encodeControls(data: FormData): URLSearchParams {
  const encoded = new URLSearchParams();
  const normalizeLineBreaks = (value: string): string => value
    .replace(/\r\n|\r|\n/gu, "\n")
    .replace(/\n/gu, "\r\n");
  for (const [name, value] of data) {
    encoded.append(
      normalizeLineBreaks(name),
      normalizeLineBreaks(typeof value === "string" ? value : value.name),
    );
  }
  return encoded;
}

export function privateNativeGetFormDestination(
  form: HTMLFormElement,
  candidate: SubmitEvent["submitter"],
  successfulControls?: FormData,
): URL | undefined {
  if (!form.isConnected || form.ownerDocument !== document) return undefined;
  if (form.relList.contains("noreferrer")) return undefined;
  const submitter = validSubmitter(form, candidate);
  if (submitter === false) return undefined;
  const method = effectiveAttribute(
    submitter,
    "formmethod",
    () => submitter?.formMethod ?? "",
    () => form.method,
  ).toLowerCase();
  if (method !== "get") return undefined;
  const target = effectiveAttribute(
    submitter,
    "formtarget",
    () => submitter?.formTarget ?? "",
    () => form.target,
  );
  if (!targetOwnsCurrentContext(target)) return undefined;
  let destination: URL;
  try {
    destination = new URL(effectiveAttribute(
      submitter,
      "formaction",
      () => submitter?.formAction ?? "",
      () => form.action,
    ), location.href);
  } catch { return undefined; }
  const current = new URL(location.href);
  const trustworthy = current.protocol === "https:"
    || (current.protocol === "http:" && loopbackHosts.has(current.hostname));
  if (!trustworthy
    || destination.protocol !== current.protocol
    || destination.origin !== current.origin
    || destination.username !== ""
    || destination.password !== "") return undefined;
  try {
    const data = successfulControls ?? (submitter ? new FormData(form, submitter) : new FormData(form));
    destination.search = encodeControls(data).toString();
  } catch { return undefined; }
  return destination;
}

export function privateFormRequest(eligibility: PrivateFormEligibility): PrivateFormRequest {
  const data = eligibility.submitter
    ? new FormData(eligibility.form, eligibility.submitter)
    : new FormData(eligibility.form);
  if (eligibility.kind === "navigation") {
    const destination = new URL(eligibility.destination);
    destination.search = encodeControls(data).toString();
    return Object.freeze({ destination });
  }
  return Object.freeze({
    destination: eligibility.destination,
    body: eligibility.encoding === "multipart/form-data" ? data : encodeControls(data),
  });
}

function dirtyControl(control: Element): boolean {
  if (control instanceof HTMLInputElement) {
    if (["checkbox", "radio"].includes(control.type)) return control.checked !== control.defaultChecked;
    if (["button", "submit", "reset", "image", "hidden"].includes(control.type)) return false;
    return control.value !== control.defaultValue;
  }
  if (control instanceof HTMLTextAreaElement) return control.value !== control.defaultValue;
  if (control instanceof HTMLSelectElement) {
    return [...control.options].some((option) => option.selected !== option.defaultSelected);
  }
  return false;
}

function controlOwner(control: Element): HTMLFormElement | null | undefined {
  if (control instanceof HTMLInputElement
    || control instanceof HTMLTextAreaElement
    || control instanceof HTMLSelectElement
    || control instanceof HTMLButtonElement) return control.form;
  return undefined;
}

export function privateFormPreservationSafe(
  eligibility: PrivateFormEligibility,
  options: Readonly<{ allowDocumentScroll?: boolean }> = {},
): boolean {
  if (!eligibility.form.isConnected || eligibility.form.ownerDocument !== document) return false;
  if (!options.allowDocumentScroll && (scrollX !== 0 || scrollY !== 0)) return false;
  if ([...document.querySelectorAll("input, textarea, select")]
    .some((control) => controlOwner(control) !== eligibility.form && dirtyControl(control))) return false;
  if (document.querySelector("details[open], dialog[open], audio, video, [data-fadeno-client-owned], [data-fadeno-island], [contenteditable]:not([contenteditable=\"false\"])") !== null) return false;
  try { if (document.querySelector(":popover-open") !== null) return false; } catch { /* unsupported selector has no open popover state */ }
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) return false;
  const active = document.activeElement;
  const activeOwner = active ? controlOwner(active) : undefined;
  const runtimeFocus = active instanceof HTMLElement
    && active === (document.querySelector("h1") ?? document.querySelector("main"))
    && active.getAttribute("data-fadeno-navigation-focus") === "";
  if (active
    && active !== document.body
    && active !== document.documentElement
    && activeOwner !== eligibility.form
    && active !== eligibility.submitter
    && !runtimeFocus) return false;
  const documentScroller = document.scrollingElement;
  for (const element of document.querySelectorAll("*")) {
    if (options.allowDocumentScroll && element === documentScroller) continue;
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) return false;
  }
  return true;
}
