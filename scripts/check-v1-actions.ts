import assert from "node:assert/strict";

import {
  actionError,
  checkboxField,
  defineAction,
  fileField,
  integerField,
  redirect,
  textField,
  type ActionUpload,
} from "../packages/framework/src/index.ts";
import {
  readActionError,
  readActionFieldToken,
  readActionState,
  registeredActionStates,
} from "../packages/framework/src/internal/action.ts";

const save = defineAction({
  fields: {
    title: textField({ maximumBytes: 128 }),
    priority: integerField({ minimum: 1, maximum: 5 }),
    archived: checkboxField(),
    brief: fileField({ required: false, maximumBytes: 1_024, acceptedTypes: ["text/plain"] }),
  },
  authorize({ input, session }) {
    const title: string = input.title;
    const priority: number = input.priority;
    const brief: ActionUpload | null = input.brief;
    assert.equal(typeof input.title, "string");
    void title;
    void priority;
    void brief;
    return session.has("viewer");
  },
  run({ input, session }) {
    const upload: ActionUpload | null = input.brief;
    if (upload) assert.equal(upload.size, upload.bytes().byteLength);
    session.set("last-title", input.title);
    return redirect("/projects");
  },
});

function assertActionRedirectTypes(): void {
  defineAction({
    fields: { title: textField() },
    authorize: () => true,
    // @ts-expect-error native action callbacks may only return same-origin 303 redirects
    run: () => redirect("/projects", 307),
  });
}
void assertActionRedirectTypes;

const state = readActionState(save);
assert.ok(state);
assert.match(state.id, /^[A-Za-z0-9_-]{32}$/u);
assert.deepEqual(Object.keys(save.fields), ["archived", "brief", "priority", "title"]);
assert.deepEqual(Object.keys(state.descriptors), ["archived", "brief", "priority", "title"]);
assert.equal(new Set(Object.values(state.generatedNames)).size, 4);
assert.ok(Object.values(state.generatedNames).every((name) => /^f_[A-Za-z0-9_-]{16}$/u.test(name)));
for (const [logicalName, token] of Object.entries(save.fields)) {
  assert.deepEqual(readActionFieldToken(token), { action: save, logicalName });
}
assert.deepEqual(registeredActionStates(), [state]);

const expected = actionError({
  code: "PROJECT_TITLE_REQUIRED",
  fieldErrors: { title: "Enter a project title." },
  formErrors: ["The project was not saved."],
});
const expectedState = readActionError(expected);
assert.ok(expectedState);
assert.equal(expectedState.code, "PROJECT_TITLE_REQUIRED");
assert.equal(expectedState.changed, false);
assert.deepEqual(Object.entries(expectedState.fieldErrors), [["title", "Enter a project title."]]);
assert.deepEqual(expectedState.formErrors, ["The project was not saved."]);

assert.throws(() => textField({ maximumBytes: 0 }), /FADENO_ACTION_DECLARATION/u);
assert.throws(() => integerField({ minimum: 2, maximum: 1 }), /FADENO_ACTION_DECLARATION/u);
assert.throws(() => fileField({ acceptedTypes: ["TEXT/PLAIN"] }), /FADENO_ACTION_DECLARATION/u);
assert.throws(() => defineAction({ fields: {}, authorize: () => true, run: () => undefined }), /FADENO_ACTION_DECLARATION/u);
assert.throws(() => actionError({ code: "lowercase" }), /FADENO_ACTION_EXPECTED_FAILURE/u);

console.log("V1 public action declarations passed (typed fields, opaque identity, expected failures)");
