import { ENDPOINTS } from "../src/server/api-v1";
for (const id of ["create_project","get_log_context","triage_deployment_error"]) {
  const e = ENDPOINTS.find(x => x.id === id);
  const schema = (e as unknown as { input?: { shape?: Record<string, unknown>; required?: string[] } })?.input;
  console.log(id, JSON.stringify(schema?.required ?? Object.keys(schema?.shape ?? {})));
}
