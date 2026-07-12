import { unsafeHtml, type UnsafeHtml } from "../../packages/framework/src/index.ts";

const trusted: UnsafeHtml = unsafeHtml("<strong>reviewed</strong>", {
  reason: "Static content reviewed against its source",
});

declare const dynamicReason: string;
unsafeHtml("<em>reviewed at runtime</em>", { reason: dynamicReason });

// @ts-expect-error ordinary strings are not raw HTML capabilities
const stringCapability: UnsafeHtml = "<script>bad()</script>";

// @ts-expect-error structurally similar objects cannot provide the private brand
const objectCapability: UnsafeHtml = {};

// @ts-expect-error a statically empty review reason is invalid
unsafeHtml("<b>missing review</b>", { reason: "" });

void trusted;
void stringCapability;
void objectCapability;
