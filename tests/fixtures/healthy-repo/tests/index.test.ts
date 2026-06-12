import { describe, it, expect } from "vitest";
import { run } from "../src/index.js";

describe("run", () => {
  it("adds 2", () => {
    expect(run(3)).toBe(5);
  });
});
