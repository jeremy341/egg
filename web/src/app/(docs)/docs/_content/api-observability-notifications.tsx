import type { ReactNode } from "react";
import { B, C, H2, P, Section } from "../_components/prose";
import { CodeBlock } from "../_components/code-block";

/** Content for the monitoring and notification API docs page. */
export const GUIDE_OBSERVABILITY_NOTIFICATIONS: Record<string, () => ReactNode> = {
  "observability-notifications": () => (
    <Section
      id="observability-notifications"
      intro="Read deployment health, logs, resource signals and visitor analytics. Manage signed notification channels and their delivery history."
    >
      <H2 id="observability-notifications-what-it-does" title="What it does" />
      <P>
        Monitoring calls return the signals Egg collects for your project: deployment checks, build output, the service
        journal, resource samples and visitor page views. <C>get_request_stats</C> counts recorded page views. It does
        not read every HTTP request. <C>get_attack_signals</C> reports repeated browser errors; it cannot confirm an
        attack.
      </P>
      <P>
        Notification channels send signed deployment events to an HTTPS address. A channel has one event filter. Its
        signing secret is returned when you create it and is never shown again. Delivery history contains status and
        error codes, not response bodies.
      </P>

      <H2 id="observability-notifications-parameters" title="Parameters" />
      <P>
        Use <C>projectId</C> for project analytics, logs and observability links. Use <C>deploymentId</C> for build
        history, diagnosis, verdicts and Compose volumes. Log searches accept a time range, a level and a page limit.
        Analytics windows accept 1 to 90 days. Notification calls use <C>channelId</C>, <C>ruleId</C> and
        <C>deliveryId</C> from earlier results.
      </P>
      <P>
        Each request needs the scope listed on its endpoint: <C>logs:read</C>, <C>deployments:read</C>,
        <C>analytics:read</C>, <C>resources:read</C>, <C>projects:read</C>, <C>webhooks:read</C> or
        <C>webhooks:write</C>. Read the full parameter schemas at <C>/api/v1/openapi.json</C>.
      </P>

      <H2 id="observability-notifications-example" title="Example" />
      <P>List the last 30 days of counted page views for one project:</P>
      <CodeBlock
        label="Terminal"
        code={`curl "$EGG_URL/api/v1/projects/$PROJECT_ID/request-stats?days=30" \\
  -H "Authorization: Bearer $EGG_TOKEN"`}
      />
      <P>List notification channels without returning their signing secrets:</P>
      <CodeBlock
        label="Terminal"
        code={`curl "$EGG_URL/api/v1/notification-channels" \\
  -H "Authorization: Bearer $EGG_TOKEN"`}
      />
      <P>
        <B>Related:</B> use <C>get_anomalies</C> to review client errors and resource pressure, and
        <C>list_notification_deliveries</C> to inspect recent sends for one channel.
      </P>
    </Section>
  ),
};
