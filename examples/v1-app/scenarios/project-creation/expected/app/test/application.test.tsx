import assert from "node:assert/strict";
import test from "node:test";
import { notFound, renderRoute } from "@fadeno/framework";
import layout from "../src/routes/layout.tsx";
import notFoundPage from "../src/routes/not-found.tsx";
import page from "../src/routes/page.tsx";
import stylesheet from "../src/routes/styles/handler.ts";

test("renders the application document through the production renderer", async () => {
  const response = await renderRoute({
    request: new Request("https://app.example/"),
    parameters: {},
    page,
    layouts: [layout],
    notFound: notFoundPage,
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Your Fadeno application is running/u);
});

test("renders the application not-found document", async () => {
  const response = await renderRoute({
    request: new Request("https://app.example/missing"),
    parameters: {},
    page: () => notFound(),
    layouts: [layout],
    notFound: notFoundPage,
  });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /Page not found/u);
});

test("serves the application stylesheet through its raw handler", async () => {
  const response = await stylesheet(new Request("https://app.example/styles"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/css; charset=utf-8");
  assert.match(await response.text(), /\.hero-card/u);
});
