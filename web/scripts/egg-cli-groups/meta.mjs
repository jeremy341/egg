import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

async function cliModule() {
  return import("../egg-cli.mjs");
}

export const commands = [
  { name: "version", args: [], description: "Print the CLI version.", runner: "metaVersion", offline: true },
  { name: "commands", args: [], description: "List every CLI command.", runner: "metaCommands", offline: true },
  { name: "exit-codes", args: [], description: "List documented process exit codes.", runner: "metaExitCodes", offline: true },
  { name: "licenses", args: [], description: "Print the CLI package license.", runner: "metaLicenses", offline: true },
  { name: "root", args: [], description: "Show the bare CLI usage text.", runner: "metaRoot", offline: true },
];

export const runners = {
  async metaVersion(_nest, _args, flags, out, _deps, _fail, kit) {
    const data = { version: packageJson.version };
    return out(flags.json ? kit.json(data) : `Egg CLI ${data.version}\n`);
  },

  async metaCommands(_nest, _args, flags, out, _deps, _fail, kit) {
    const { COMMANDS } = await cliModule();
    const names = COMMANDS.map(({ name }) => name);
    return out(flags.json ? kit.json(names) : `${names.join("\n")}\n`);
  },

  async metaExitCodes(_nest, _args, flags, out, _deps, _fail, kit) {
    const codes = [
      { code: 0, meaning: "done" },
      { code: 1, meaning: "failed" },
      { code: 2, meaning: "wrong use" },
    ];
    return out(flags.json ? kit.json(codes) : `${codes.map(({ code, meaning }) => `${code} ${meaning}`).join("\n")}\n`);
  },

  async metaLicenses(_nest, _args, flags, out, _deps, _fail, kit) {
    const license = packageJson.license ?? "no license declared";
    return out(flags.json ? kit.json({ license }) : `${license}\n`);
  },

  async metaRoot(_nest, _args, flags, out, _deps, _fail, kit) {
    const { USAGE } = await cliModule();
    return out(flags.json ? kit.json({ usage: USAGE }) : USAGE);
  },
};

export const optionTypes = {};
