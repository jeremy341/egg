export type PlainDeployFailure = {
  plainMessage: string;
  plainLine: string;
};

function latestLine(lines: string[], pattern: RegExp): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (pattern.test(lines[i])) return lines[i];
  }
  return null;
}

function portFromAddressInUseLine(line: string): number | null {
  const codeAt = line.search(/EADDRINUSE/i);
  if (codeAt < 0) return null;

  const detail = line.slice(codeAt + "EADDRINUSE".length);
  const matches = [...detail.matchAll(/(?:\bport\s+|:)(\d{1,5})\b/gi)];
  const port = Number(matches.at(-1)?.[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function memoryLimitFromLines(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/\b(?:capped at|memory (?:limit|cap|max(?:imum)?)(?:\s+of)?)\s*[:=]?\s*([\d,]+)\s*(?:MB|MiB)\b/i);
    const limit = Number(match?.[1]?.replace(/,/g, ""));
    if (Number.isInteger(limit) && limit > 0) return limit;
  }
  return null;
}

export function classifyPlainDeployFailure(input: {
  lines: string[];
  port?: number | null;
  memoryLimitMb?: number | null;
  stage?: string;
}): PlainDeployFailure | null {
  const addressInUse = latestLine(input.lines, /EADDRINUSE/i);
  if (addressInUse) {
    const port = portFromAddressInUseLine(addressInUse) ?? input.port;
    if (port) {
      return {
        plainMessage: `Port ${port} is already in use by another process.`,
        plainLine: addressInUse,
      };
    }
  }

  const oomLine = latestLine(
    input.lines,
    /\b(?:oom[- ]?kill|killed by (?:the )?oom killer|out of memory|(?:exit(?:ed)?|code|status)\s*(?:code|status)?\s*[=:]?\s*(?:137|9))\b/i,
  );
  if (oomLine) {
    const providedLimit = typeof input.memoryLimitMb === "number" && Number.isInteger(input.memoryLimitMb) && input.memoryLimitMb > 0
      ? input.memoryLimitMb
      : null;
    const configuredLimit = providedLimit ?? (input.stage === "building" ? memoryLimitFromLines(input.lines) : null);
    return {
      plainMessage: configuredLimit === null
        ? "Memory ran out. The configured limit is not recorded in these deploy details."
        : `Memory ran out. The configured limit is ${configuredLimit} MB.`,
      plainLine: oomLine,
    };
  }

  const moduleLine = latestLine(input.lines, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|No module named/i);
  if (moduleLine) {
    const moduleName =
      moduleLine.match(/Cannot find (?:module|package)\s+['"]([^'"]+)['"]/i)?.[1] ??
      moduleLine.match(/No module named\s+['"]?([^'"\s]+)['"]?/i)?.[1] ??
      moduleLine.match(/(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)\s*[:=]\s*['"]?([^'"\s]+)/i)?.[1];
    if (moduleName) {
      return {
        plainMessage: `Module "${moduleName}" could not be found. The install step may not have run.`,
        plainLine: moduleLine,
      };
    }
  }

  const emptyStartLine = latestLine(
    input.lines,
    /empty start command|start command.{0,30}\b(?:empty|not set|missing|blank)\b|nothing to run|no start command|set a start command/i,
  );
  if (emptyStartLine) {
    return { plainMessage: "The start command is empty.", plainLine: emptyStartLine };
  }

  if (input.stage === "starting" || input.stage === "health") {
    const exitOneLine = latestLine(input.lines, /\b(?:exit(?:ed)?|code|status)\s*(?:code|status)?\s*[=:]?\s*1\b/i);
    if (exitOneLine) {
      return {
        plainMessage: "The app exited during startup. Check the last lines of the log for details.",
        plainLine: exitOneLine,
      };
    }
  }

  return null;
}
