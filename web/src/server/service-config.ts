import { isIP } from "node:net";
import { z } from "zod";
import { HttpError } from "@/server/http";

const portNumber = z.number().int().min(1).max(65535);

/** Egg's listener mapping: one port on the Nest host and its target in a container. */
export const servicePortSchema = z.object({
  name: z.string().trim().min(1).max(63).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).optional().describe("Optional label for this listener."),
  containerPort: portNumber.describe("Port the application listens on inside a container."),
  servicePort: portNumber.describe("Port assigned to this listener on the Nest server."),
  protocol: z.enum(["TCP", "UDP"]).default("TCP").describe("Transport protocol; defaults to TCP."),
}).strict();

export const servicePortsSchema = z.array(servicePortSchema).max(1000).superRefine((ports, ctx) => {
  const names = new Set<string>();
  const hostPorts = new Set<number>();
  ports.forEach((port, index) => {
    if (names.has(port.name ?? "") && port.name) {
      ctx.addIssue({ code: "custom", path: [index, "name"], message: "Port names must be unique." });
    }
    if (port.name) names.add(port.name);
    if (hostPorts.has(port.servicePort)) {
      ctx.addIssue({ code: "custom", path: [index, "servicePort"], message: "Each exposed port must use a different Nest port." });
    }
    hostPorts.add(port.servicePort);
  });
});

export type ServicePort = z.output<typeof servicePortSchema>;

const INTERNAL_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function normalizeInternalDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (isIP(domain) || !INTERNAL_HOST.test(domain)) {
    throw new HttpError(400, "Enter an internal DNS name, such as api.internal.", "validation");
  }
  return domain;
}

type PortSource = {
  servicePorts?: string | null;
  port: number;
  listenPort: number | null;
  containerPort: number | null;
  workloadKind: "web" | "worker";
};

/** Read a saved list; old Egg projects fall back to their existing one-port model. */
export function servicePortsForProject(project: PortSource): ServicePort[] {
  if (project.servicePorts) {
    try {
      const saved = servicePortsSchema.safeParse(JSON.parse(project.servicePorts));
      if (saved.success) return saved.data;
    } catch {
      // Fall through to the compatible single-port view for a malformed legacy value.
    }
  }

  const servicePort = project.port > 0 ? project.port : project.listenPort;
  if (servicePort == null || servicePort < 1) return [];
  return [{
    containerPort: project.containerPort ?? project.listenPort ?? servicePort,
    servicePort,
    protocol: "TCP",
  }];
}
