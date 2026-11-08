import { describe, expect, it } from "vitest";
import { failureText, settle } from "../../src/runtime/settledTasks";

describe("settled runtime tasks", () => {
  it("settles a resolved task with its value and a rejected task with its error", async () => {
    const rejection = new Error("Package hash differs.");
    await expect(settle(Promise.resolve(7))).resolves.toEqual({ ok: true, value: 7 });
    await expect(settle(Promise.reject(rejection))).resolves.toEqual({ ok: false, error: rejection });
  });

  it("uses an error's message and the fallback for anything that is not an Error", () => {
    expect(failureText(new Error("Package hash differs."), "Package failed.")).toBe("Package hash differs.");
    expect(failureText("not an error", "Package failed.")).toBe("Package failed.");
  });
});
