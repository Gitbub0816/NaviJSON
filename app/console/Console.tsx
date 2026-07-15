"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./console.module.css";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  revoked: number;
  requestCount: number;
  lastUsedAt: number | null;
};

type CreatedKey = {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
};

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function Console() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [d1Missing, setD1Missing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (res.status === 503) {
        setD1Missing(true);
        setKeys([]);
        return;
      }
      setD1Missing(false);
      const data = (await res.json()) as { keys?: ApiKeyRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load API keys.");
        return;
      }
      setKeys(data.keys ?? []);
    } catch {
      setError("Could not reach the API. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; state updates happen inside the async loader, not synchronously
    void loadKeys();
  }, [loadKeys]);

  const handleCreate = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;

      setCreating(true);
      setError(null);
      setFreshKey(null);
      setCopied(false);
      try {
        const res = await fetch("/api/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (res.status === 503) {
          setD1Missing(true);
          return;
        }
        const data = (await res.json()) as CreatedKey & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Failed to create API key.");
          return;
        }
        setFreshKey(data);
        setName("");
        await loadKeys();
      } catch {
        setError("Could not create the key. Please try again.");
      } finally {
        setCreating(false);
      }
    },
    [name, loadKeys]
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
        if (res.status === 503) {
          setD1Missing(true);
          return;
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Failed to revoke key.");
          return;
        }
        await loadKeys();
      } catch {
        setError("Could not revoke the key. Please try again.");
      }
    },
    [loadKeys]
  );

  const copyKey = useCallback(async () => {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [freshKey]);

  const totalRequests = useMemo(
    () => keys.reduce((sum, k) => sum + (k.requestCount ?? 0), 0),
    [keys]
  );
  const activeCount = useMemo(
    () => keys.filter((k) => !k.revoked).length,
    [keys]
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>NaviJSON</p>
            <h1 className={styles.title}>Developer Console</h1>
            <p className={styles.subtitle}>
              Create and manage API keys, and meter usage against your Cloudflare
              D1 database.
            </p>
          </div>
        </header>

        {d1Missing && (
          <div className={`${styles.notice} ${styles.noticeWarn}`} role="status">
            <strong>Connect a D1 database to enable API keys.</strong>
            <span>
              This environment has no D1 binding yet. Provision one with{" "}
              <code>wrangler d1 create</code> and bind it as <code>DB</code>. See{" "}
              <code>docs/DEVCONSOLE.md</code>.
            </span>
          </div>
        )}

        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            {error}
          </div>
        )}

        <section className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Active keys</span>
            <span className={styles.statValue}>{activeCount}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total keys</span>
            <span className={styles.statValue}>{keys.length}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Total requests</span>
            <span className={styles.statValue}>
              {totalRequests.toLocaleString()}
            </span>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Create a new key</h2>
          <p className={styles.cardHint}>
            Give the key a name so you can recognize it later. The secret is shown
            only once at creation.
          </p>
          <form className={styles.createForm} onSubmit={handleCreate}>
            <input
              className={styles.input}
              type="text"
              placeholder="e.g. Production server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating || d1Missing}
              maxLength={80}
              aria-label="API key name"
            />
            <button
              className={styles.primaryBtn}
              type="submit"
              disabled={creating || d1Missing || !name.trim()}
            >
              {creating ? "Creating…" : "Create key"}
            </button>
          </form>

          {freshKey && (
            <div className={styles.freshKey} role="status">
              <div className={styles.freshKeyHead}>
                <strong>Copy your key now — you won&apos;t see it again.</strong>
              </div>
              <div className={styles.freshKeyRow}>
                <code className={styles.freshKeyValue}>{freshKey.key}</code>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={copyKey}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className={styles.freshKeyMeta}>
                Named <strong>{freshKey.name}</strong> · prefix{" "}
                <code>{freshKey.keyPrefix}</code>
              </p>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeaderRow}>
            <h2 className={styles.cardTitle}>API keys</h2>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => void loadKeys()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {loading && keys.length === 0 ? (
            <p className={styles.empty}>Loading keys…</p>
          ) : keys.length === 0 ? (
            <p className={styles.empty}>
              {d1Missing
                ? "No keys — connect a D1 database to get started."
                : "No API keys yet. Create your first key above."}
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Created</th>
                    <th>Requests</th>
                    <th>Last used</th>
                    <th>Status</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className={k.revoked ? styles.rowRevoked : ""}>
                      <td>{k.name || "—"}</td>
                      <td>
                        <code className={styles.prefix}>{k.keyPrefix}…</code>
                      </td>
                      <td>{formatDate(k.createdAt)}</td>
                      <td>{(k.requestCount ?? 0).toLocaleString()}</td>
                      <td>{formatDate(k.lastUsedAt)}</td>
                      <td>
                        {k.revoked ? (
                          <span className={`${styles.badge} ${styles.badgeRevoked}`}>
                            Revoked
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeActive}`}>
                            Active
                          </span>
                        )}
                      </td>
                      <td className={styles.actionsCell}>
                        {!k.revoked && (
                          <button
                            type="button"
                            className={styles.dangerBtn}
                            onClick={() => void handleRevoke(k.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Billing is intentionally a STUB for this stage. Stripe is out of scope. */}
        <section className={`${styles.card} ${styles.billingCard}`}>
          <div className={styles.cardHeaderRow}>
            <h2 className={styles.cardTitle}>Billing</h2>
            <span className={styles.soonBadge}>Coming soon</span>
          </div>
          <p className={styles.cardHint}>
            Billing (Stripe) is not yet integrated. Usage is metered above and
            will map to paid plans in a future release.
          </p>
          <div className={styles.billingStub} aria-hidden="true">
            <div className={styles.planRow}>
              <div>
                <div className={styles.planName}>Free</div>
                <div className={styles.planMeta}>Current plan · metering only</div>
              </div>
              <button type="button" className={styles.primaryBtn} disabled>
                Manage billing
              </button>
            </div>
            <div className={styles.planRow}>
              <div>
                <div className={styles.planName}>Pro</div>
                <div className={styles.planMeta}>Stripe checkout — stubbed</div>
              </div>
              <button type="button" className={styles.ghostBtn} disabled>
                Upgrade
              </button>
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          Metering endpoint: <code>GET/POST /api/validate</code> with{" "}
          <code>Authorization: Bearer &lt;key&gt;</code>
        </footer>
      </div>
    </main>
  );
}
