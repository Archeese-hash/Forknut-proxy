import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = file => readFile(new URL(file, import.meta.url), "utf8");

test("clean interface contains no games or TIDAL artwork", async () => {
  const html = await read("../public/index.html");
  assert.doesNotMatch(html, /id=["\']games|gamesButton|public\/games|tidal\.(?:png|jpe?g|webp)/i);
  assert.match(html, /id="circles"/);
  assert.match(html, /Made by Archie Faulkner/);
});

test("service worker routes normal images through Scramjet before fallback", async () => {
  const sw = await read("../public/sw.js");
  const route = sw.indexOf("const response = await $scramjetController.route(event)");
  const fallback = sw.indexOf("const fallback = await fallbackImage(request)");
  assert.ok(route >= 0 && fallback > route);
});
