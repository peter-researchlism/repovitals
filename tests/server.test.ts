import { describe, it, expect } from "vitest";
import { createServer } from "../src/server.js";

/**
 * We don't drive JSON-RPC over stdio in unit tests (it would conflict with
 * vitest's own I/O). Instead we verify that `createServer` returns a server
 * instance with the four tools registered. The exact tool-name strings are
 * part of the public contract and must not drift silently.
 */
describe("MCP server", () => {
  it("registers exactly the four expected tools", () => {
    const server = createServer();
    // The MCP SDK exposes a private internal registry; we use a duck-typed
    // accessor to read the registered tool names.
    const internal = server as unknown as {
      _registeredTools?: Record<string, unknown>;
    };
    const names = Object.keys(internal._registeredTools ?? {}).sort();
    expect(names).toEqual(["check_health", "find_rot", "make_plan", "scan_dependencies"]);
  });
});
