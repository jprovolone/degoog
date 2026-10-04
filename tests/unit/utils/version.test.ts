import { describe, expect, test } from "bun:test";
import { isUpdateAvailable, isVersionAtLeast } from "../../../src/shared/utils/version";

describe("isUpdateAvailable", () => {
  test.each([
    ["1.0.0", "1.0.1", true],
    ["1.0.1", "1.0.0", false],
    ["1.0.0", "1.0.0", false],
    ["1.9.0", "1.10.0", true],
  ])("core %s -> %s is %p", (current, newest, expected) => {
    expect(isUpdateAvailable(current, newest)).toBe(expected);
  });

  test.each([
    ["1.0.0-dev", "1.0.0", true],
    ["1.0.0", "1.0.0-dev", false],
    ["1.0.0-dev.1", "1.0.0-dev.2", true],
    ["1.0.0-dev.2", "1.0.0-dev.1", false],
    ["1.0.0-dev", "1.0.0-dev.1", true],
    ["1.0.0-dev-3", "1.0.0-dev.3", false],
    ["1.0.0-dev.1", "1.0.1-dev", true],
    ["1.0.0-dev", "1.0.0-beta.6", true],
    ["1.0.0-beta.6", "1.0.0-dev", false],
  ])("dev %s -> %s is %p", (current, newest, expected) => {
    expect(isUpdateAvailable(current, newest)).toBe(expected);
  });

  test.each([
    ["1.0.0-beta.6", "1.0.0", true],
    ["1.0.0", "1.0.0-beta.6", false],
    ["1.0.0-beta.6", "1.0.0-beta.7", true],
    ["1.0.0-beta.7", "1.0.0-beta.6", false],
    ["1.0.0-beta.6", "1.0.0-beta.6", false],
    ["1.0.0-beta.9", "1.0.0-beta.10", true],
    ["1.0.0-alpha", "1.0.0-beta", true],
    ["1.0.0-beta", "1.0.0-beta.1", true],
    ["1.0.0-beta.1", "1.0.0-beta", false],
    ["1.0.0-1", "1.0.0-alpha", true],
    ["1.0.0-rc.1", "1.0.0-rc.1+build.5", false],
    ["0.9.0", "1.0.0-beta.1", true],
    ["1.0.0-beta.6", "0.9.9", false],
  ])("pre-release %s -> %s is %p", (current, newest, expected) => {
    expect(isUpdateAvailable(current, newest)).toBe(expected);
  });
});

describe("isVersionAtLeast", () => {
  test.each([
    ["1.0.0", "1.0.0", true],
    ["1.0.0-beta.6", "1.0.0", true],
    ["1.0.0", "1.0.1", false],
    ["1.2.0", "1.1.9", true],
    ["1.0.0-dev", "1.0.0", true],
  ])("%s satisfies %s is %p", (current, required, expected) => {
    expect(isVersionAtLeast(current, required)).toBe(expected);
  });
});
