"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { providerLabel, type SourceProvider } from "@/components/repository-source";
import { Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type ProviderRepository = { id: string | number; fullName: string; cloneUrl: string; defaultBranch: string; private: boolean };
type Connection = { id: string; provider: SourceProvider; label: string; host: string; username?: string; createdAt: string };

export function ProviderConnections({ provider, onPick }: {
  provider: Exclude<SourceProvider, "github" | "generic">;
  onPick: (repository: ProviderRepository, connectionId: string) => void;
}) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [repositories, setRepositories] = useState<ProviderRepository[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState(provider === "gitlab" ? "https://gitlab.com" : provider === "codeberg" ? "https://codeberg.org" : "");
  const tokenRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const name = providerLabel(provider);

  useEffect(() => {
    let live = true;
    api<{ connections: Connection[] }>("/api/providers/connections").then(({ connections: all }) => {
      if (!live) return;
      const list = all.filter((c) => c.provider === provider);
      setConnections(list);
      setLoading(list.length > 0);
      setConnectionId(list[0]?.id ?? "");
    }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [provider, retry]);

  useEffect(() => {
    if (!connectionId) return;
    let live = true;
    api<{ repositories: ProviderRepository[] }>(`/api/providers/${provider}/repositories?connectionId=${encodeURIComponent(connectionId)}`)
      .then(({ repositories: list }) => { if (live) setRepositories(list); })
      .catch((e: Error) => { if (live) { setRepositories(null); setError(e.message); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [provider, connectionId, retry]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api<{ connection: Connection }>("/api/providers/connections", { body: { provider, label: label.trim(), host: host.trim() || undefined, accessToken: tokenRef.current?.value || undefined } });
      if (tokenRef.current) tokenRef.current.value = "";
      setConnections((all) => [...(all ?? []), result.connection]);
      setLoading(true);
      setConnectionId(result.connection.id);
      setAdding(false); setLabel("");
      setNotice(`${name} connected. Choose a repository below.`);
    } catch (e) { setError(e instanceof Error ? e.message : `Could not connect ${name}.`); }
    finally { if (tokenRef.current) tokenRef.current.value = ""; setBusy(false); }
  }

  async function disconnect() {
    if (!connectionId) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/providers/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      const remaining = (connections ?? []).filter((c) => c.id !== connectionId);
      setConnections(remaining); setConnectionId(remaining[0]?.id ?? ""); setRepositories(null);
      setLoading(remaining.length > 0);
      setNotice(`${name} connection removed.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not disconnect."); }
    finally { setBusy(false); }
  }

  const list = (repositories ?? []).filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="space-y-4 rounded-lg bg-card p-5 shadow-border-small">
    <div><h3 className="font-medium">Connect {name}</h3><p className="mt-1 text-label text-muted-foreground">Connect an account to browse its repositories. Tokens are stored encrypted and are never shown again. Public repositories can also be imported by URL below.</p></div>
    {error && <Alert tone="error" role="alert"><p>{error}</p><Button variant="outline" className="mt-2" onClick={() => { setError(null); setLoading(Boolean(connectionId)); setRetry((value) => value + 1); }}>Try again</Button></Alert>}
    {notice && <p role="status" className="text-label text-muted-foreground">{notice}</p>}
    {connections === null && !error && <p role="status" className="text-label text-muted-foreground">Loading connections…</p>}
    {connections && connections.length > 0 && <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 max-sm:basis-full"><Label htmlFor="provider-connection">Connection</Label><NativeSelect id="provider-connection" value={connectionId} onChange={(e) => { setRepositories(null); setError(null); setLoading(true); setConnectionId(e.target.value); }}>{connections.map((c) => <option key={c.id} value={c.id}>{c.label} · {c.host}</option>)}</NativeSelect></div>
      <Button variant="ghost" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button>
    </div>}
    {adding || connections?.length === 0 ? <form onSubmit={connect} className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="provider-label">Connection name</Label><Input id="provider-label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Personal account" /></div>
      <div><Label htmlFor="provider-host">Server URL</Label><Input id="provider-host" type="url" required readOnly={provider === "codeberg"} value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://git.example.org" autoComplete="off" /></div>
      <div className="sm:col-span-2"><Label htmlFor="provider-token">Access token</Label><Input id="provider-token" ref={tokenRef} type="password" required autoComplete="off" spellCheck={false} aria-describedby="provider-token-help" /><p id="provider-token-help" className="mt-1.5 text-label text-muted-foreground">Use a token with repository read access. It is cleared after every connection attempt.</p></div>
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={busy} disabled={!label.trim() || !host.trim()}>{busy ? "Connecting…" : `Connect ${name}`}</Button>{connections && connections.length > 0 && <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>}</div>
    </form> : <Button variant="outline" disabled={!connections} onClick={() => setAdding(true)}>Add a connection</Button>}
    {loading && <p role="status" className="text-label text-muted-foreground">Loading repositories…</p>}
    {!loading && repositories && <div className="space-y-3"><Label htmlFor="provider-search">Search repositories</Label><Input id="provider-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories…" />
      {list.length ? <ul className="hairline-y">{list.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0 break-words font-medium">{r.fullName}{r.private && <Badge variant="outline" className="ml-2">Private</Badge>}</span><Button size="sm" onClick={() => onPick(r, connectionId)}>Import<span className="sr-only"> {r.fullName}</span></Button></li>)}</ul> : <p className="text-label text-muted-foreground">{query ? "No matching repositories." : "No repositories are available to this connection."}</p>}
    </div>}
    <p className="text-label text-muted-foreground">Repository access and deployment are separate. Push automation and preview support depend on this provider&apos;s configured capabilities.</p>
  </div>;
}
