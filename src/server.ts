import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scanDependencies } from "./tools/scan-dependencies.js";
import { checkHealth } from "./tools/check-health.js";
import { findRot } from "./tools/find-rot.js";
import { makePlan } from "./tools/make-plan.js";

/**
 * Build the MCP server with all four tools registered. Exported separately
 * from `index.ts` so unit tests can introspect tool registration.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "repovitals",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const repoPathSchema = {
    repoPath: z
      .string()
      .min(1)
      .describe("Absolute or relative path to the local repository to inspect"),
  };

  server.tool(
    "scan_dependencies",
    "Read package.json + lockfile and return each dependency with its status (ok / outdated / possibly-abandoned / unknown). Best-effort npm registry lookup; never throws on network failure.",
    repoPathSchema,
    async (args) => {
      const result = await scanDependencies(args.repoPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "check_health",
    "Return a pass/fail checklist for CI config, test script, README, lockfile, and tests directory.",
    repoPathSchema,
    async (args) => {
      const result = await checkHealth(args.repoPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "find_rot",
    "Static scan for broken relative imports, possibly-unused files, and TODO/FIXME density.",
    repoPathSchema,
    async (args) => {
      const result = await findRot(args.repoPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "make_plan",
    "Aggregate scan_dependencies, check_health, and find_rot into a prioritized P0/P1/P2 Markdown remediation report. Returns { markdown, summary }.",
    repoPathSchema,
    async (args) => {
      const result = await makePlan(args.repoPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

/** Connect a server to stdio. Used by `npm start`. */
export async function startStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The server keeps the process alive; errors are surfaced via the transport.
}
