import { describe, test, expect } from "bun:test";
import { autocompleteCache } from "../../src/server/utils/cache/cache";
import { initAutocomplete } from "../../src/server/extensions/autocomplete/registry";

describe("autocomplete cache", () => {
  test("reloading providers drops suggestions cached by the old ones", async () => {
    await autocompleteCache.set("ac:ס", [{ text: "×¡×•×›×•×ª", source: "Google" }]);
    await initAutocomplete(true);
    expect(await autocompleteCache.get("ac:ס")).toBeNull();
  });

  test("a plain init keeps the cache", async () => {
    await autocompleteCache.set("ac:ב", [{ text: "ביטוח לאומי", source: "Google" }]);
    await initAutocomplete();
    expect(await autocompleteCache.get("ac:ב")).not.toBeNull();
  });
});
