export type PlainDeployFailure = {
  plainMessage: string;
  plainLine: string;
};

function portFromAddressInUseLine(line: string): number | null {
  const codeAt = line.search(/EADDRINUSE/i);
  if (codeAt < 0) return null;

  const detail = line.slice(codeAt + "EADDRINUSE".length);
  const matches = [...detail.matchAll(/(?:\bport\s+|:)(\d{1,5})\b/gi)];
  const port = Number(matches.at(-1)?.[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function classifyPlainDeployFailure(input: {
  lines: string[];
  port?: number | null;
}): PlainDeployFailure | null {
  for (let i = input.lines.length - 1; i >= 0; i--) {
    const line = input.lines[i];
    if (!/EADDRINUSE/i.test(line)) continue;

    const port = portFromAddressInUseLine(line) ?? input.port;
    if (!port) return null;

    return {
      plainMessage: `Port ${port} is already in use by another process.`,
      plainLine: line,
    };
  }

  return null;
}
