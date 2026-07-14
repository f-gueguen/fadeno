import { defineAction, textField } from "../packages/framework/src/index.ts";

const choose = defineAction({
  fields: { category: textField({ required: false }) },
  authorize: () => true,
  run: () => undefined,
});

void <select name={choose.fields.category}><option value="one">One</option></select>;
void <select multiple><option value="one">One</option></select>;
// @ts-expect-error V1 action descriptors are single-value and cannot name a multiple select
void <select name={choose.fields.category} multiple><option value="one">One</option></select>;
