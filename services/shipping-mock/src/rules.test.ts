import assert from "node:assert/strict";
import { test } from "node:test";
import { geocode } from "./rules.ts";

test("geocode resolves metro and remote, and refuses Nowhere", () => {
  assert.deepEqual(geocode({ line1: "12 Lygon St", city: "Carlton", postcode: "3053" }), {
    resolved: true,
    zone: "metro",
  });
  assert.deepEqual(geocode({ line1: "4 Todd St", city: "Alice Springs", postcode: "0870" }), {
    resolved: true,
    zone: "remote",
  });
  assert.deepEqual(geocode({ line1: "1 Nowhere Rd", city: "Atlantis", postcode: "0000" }), {
    resolved: false,
  });
  assert.deepEqual(geocode({ line1: "1 Main St", city: "X", postcode: "abc" }), {
    resolved: false,
  });
});
