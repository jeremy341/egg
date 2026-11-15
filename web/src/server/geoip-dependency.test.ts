import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { expect, it } from "vitest";

it("keeps geoip-country's database updater compatible with the patched IP-address dependency", () => {
  const packagePath = require.resolve("geoip-country/package.json");
  const fromGeoip = createRequire(packagePath);
  const { Address4 } = fromGeoip("ip-address");
  const source = readFileSync(path.join(path.dirname(packagePath), "scripts/updatedb.js"), "utf8");
  // Execute the actual four conversion statements changed by our vendor patch, offline.
  const statements = source.split(/\r?\n/).filter(line => /^\s*(sip|eip) = parseInt\(rngip\./.test(line));
  expect(statements).toHaveLength(4);
  const context = { rngip: new Address4("10.1.2.0/24"), parseInt, sip: 0, eip: 0 };
  const values = statements.map(line => vm.runInNewContext(line.trim(), context));
  expect(values).toEqual([167838208, 167838463, 167838208, 167838463]);
});
