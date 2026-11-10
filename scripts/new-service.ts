#!/usr/bin/env node
/**
 * Generator (landscape §6): copies a template, fills the names, adds the compose entry.
 *
 *   node scripts/new-service.ts loyalty --consumes shipment.delivered --port 3005
 *   node scripts/new-service.ts fraud --agent --consumes payment.authorized --emits fraud.cleared,fraud.flagged
 *
 * A new service changes no existing queue (design §14). This script changes one existing file: compose.yaml.
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: "boolean", default: false },
    consumes: { type: "string", default: "" },
    emits: { type: "string", default: "" },
    port: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const name = positionals[0];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(
    "usage: new-service.ts <name> [--agent] [--consumes a,b] [--emits c] [--port N]\nname: lowercase letters, digits, dashes",
  );
  process.exit(2);
}

const root = path.join(import.meta.dirname, "..");
const kind = values.agent ? "agent" : "service";
const template = path.join(root, values.agent ? "_template-agent" : "_template-service");
const target = path.join(root, values.agent ? "agents" : "services", name);
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const quoted = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");
const camel = name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const fill = (text: string) =>
  text
    .replaceAll("__CONSUMES__", quoted(list(values.consumes)))
    .replaceAll("__EMITS__", quoted(list(values.emits)))
    .replaceAll("__CAMEL__", camel)
    .replaceAll("__DB__", name.replaceAll("-", "_"))
    .replaceAll("__NAME__", name);

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

if (await exists(target)) {
  console.error(`${target} exists; stopping`);
  process.exit(1);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const composePath = path.join(root, "compose.yaml");
const compose = await readFile(composePath, "utf8");
const port = values.port ?? "3000";
const entry = values.agent
  ? `
  agent-${name}:
    <<: *node
    command: node agents/${name}/main.ts
    environment:
      MCP_SERVERS: ""
`
  : `
  ${name}:
    <<: *node
    command: node services/${name}/src/main.ts
    environment:
      DATABASE_URL: postgres://ac:ac@postgres:5432/${name.replaceAll("-", "_")}
      PORT: "${port}"
`;
if (!compose.includes("\nvolumes:"))
  throw new Error("compose.yaml has no volumes: section to insert before");
const newCompose = compose.replace("\nvolumes:", `${entry}\nvolumes:`);

if (values["dry-run"]) {
  console.log(`would create ${kind} ${target} and add to compose.yaml:${entry}`);
  process.exit(0);
}

await mkdir(target, { recursive: true });
await cp(template, target, { recursive: true });
for (const file of await walk(target)) {
  const text = await readFile(file, "utf8");
  await writeFile(file, fill(text));
}
await writeFile(composePath, newCompose);

console.log(`created ${kind} ${path.relative(root, target)} and added it to compose.yaml`);
console.log("next: npm install  (links the workspace), then docker compose up --build");
if (values.agent)
  console.log(`then set MCP_SERVERS for agent-${name} in compose.yaml and write ${name}/prompt.md`);
