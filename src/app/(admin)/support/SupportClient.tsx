// Support inbox — split view. Left rail lists threads with status tabs
// and search; right pane shows the selected thread's messages + composer.
// Polls every 5s while a thread is open. Phase 3a is admin-only:
// merchant/supplier can't see or send yet.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@iconify/react";
import {
  SUPPORT_STATUS_LABELS,
  SUPPORT_THREAD_STATUSES,
  type SupportThreadStatusValue,
} from "@/lib/support/constants";
import {
  humanFileSize,
  uploadSupportAttachment,
  type UploadedAttachment,
} from "@/lib/support/upload-attachment";

// Status → tab pill styling. Kept close to the existing Applications
// palette so both inboxes read the same at a glance.
const STATUS_STYLES: Record<
  SupportThreadStatusValue,
  { bg: string; text: string }
> = {
  OPEN: { bg: "bg-blue-100", text: "text-blue-800" },
  WAITING_MERCHANT: { bg: "bg-amber-100", text: "text-amber-900" },
  WAITING_SUPPLIER: { bg: "bg-amber-100", text: "text-amber-900" },
  WAITING_ADMIN: { bg: "bg-rose-100", text: "text-rose-800" },
  RESOLVED: { bg: "bg-emerald-100", text: "text-emerald-800" },
  CLOSED: { bg: "bg-gray-200", text: "text-gray-700" },
};

const FILTER_TABS: { key: SupportThreadStatusValue | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "WAITING_ADMIN", label: "Waiting on us" },
  { key: "WAITING_MERCHANT", label: "Waiting on merchant" },
  { key: "WAITING_SUPPLIER", label: "Waiting on supplier" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
];

const POLL_MS = 5000;

interface ThreadListRow {
  id: string;
  subject: string;
  status: SupportThreadStatusValue;
  entityType: string | null;
  entityId: string | null;
  merchantTenantId: string | null;
  merchantTenantName: string | null;
  supplierTenantId: string | null;
  supplierTenantName: string | null;
  createdByType: string;
  createdByName: string | null;
  assignedAdminId: string | null;
  assignedAdmin: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  lastMessageAt: string;
  createdAt: string;
  _count: { messages: number };
}

interface AttachmentView {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
}

interface Message {
  id: string;
  threadId: string;
  senderType: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  internalNote: boolean;
  createdAt: string;
  attachments?: AttachmentView[];
}

interface ThreadDetail extends ThreadListRow {
  closedAt: string | null;
  createdByAdmin: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  messages: Message[];
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function counterpartyLabel(t: ThreadListRow): string {
  const parts: string[] = [];
  if (t.merchantTenantId) {
    parts.push(`Merchant: ${t.merchantTenantName ?? t.merchantTenantId.slice(0, 8)}`);
  }
  if (t.supplierTenantId) {
    parts.push(`Supplier: ${t.supplierTenantName ?? t.supplierTenantId.slice(0, 8)}`);
  }
  return parts.join(" · ") || "—";
}

export default function SupportClient() {
  const [activeStatus, setActiveStatus] =
    useState<SupportThreadStatusValue | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [threads, setThreads] = useState<ThreadListRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const listUrl = useMemo(() => {
    const url = new URL("/api/admin/support/threads", window.location.origin);
    if (activeStatus !== "ALL") url.searchParams.set("status", activeStatus);
    if (search.trim()) url.searchParams.set("search", search.trim());
    return url.pathname + url.search;
  }, [activeStatus, search]);

  const fetchList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { threads: ThreadListRow[] };
      setThreads(data.threads);
    } catch (err) {
      toast.error("Failed to load threads");
      console.error(err);
    } finally {
      setLoadingList(false);
    }
  }, [listUrl]);

  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/support/threads/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { thread: ThreadDetail };
      setDetail(data.thread);
    } catch (err) {
      toast.error("Failed to load thread");
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Debounced re-fetch on filter/search change.
  useEffect(() => {
    const t = setTimeout(() => fetchList(), 200);
    return () => clearTimeout(t);
  }, [fetchList]);

  // Poll list + detail while the tab is visible. Backing off when hidden
  // keeps quiet inboxes from spamming Aurora at midnight.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (document.hidden) return;
      fetchList();
      if (selectedId) fetchDetail(selectedId);
    };
    timer = setInterval(tick, POLL_MS);

    const onVis = () => alive && tick();
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchList, fetchDetail, selectedId]);

  // Auto-scroll to newest message when detail changes.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
      // Mark read for this admin. Per-admin receipts, so opening a thread
      // clears my badge but not other operators'.
      fetch(`/api/admin/support/threads/${selectedId}/read`, { method: "POST" }).catch(() => {});
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  async function onCreated(id: string) {
    setShowNew(false);
    await fetchList();
    setSelectedId(id);
    toast.success("Thread opened");
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-180px)] min-h-[520px]">
      {/* LEFT RAIL — thread list */}
      <aside className="w-[380px] shrink-0 flex flex-col bg-white rounded-2xl border border-gray-100">
        <div className="p-3 border-b border-gray-100 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            <Icon icon="solar:add-square-linear" className="w-4 h-4" />
            New thread
          </button>
          <div className="relative flex-1">
            <Icon
              icon="solar:magnifer-linear"
              className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search subject or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 pl-8 pr-2 py-1.5 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
        </div>

        <div className="px-2 pt-2 pb-1 flex flex-wrap gap-1 border-b border-gray-100">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveStatus(t.key)}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                activeStatus === t.key
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingList && threads.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">
              No threads match this filter.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {threads.map((t) => {
                const style = STATUS_STYLES[t.status];
                const active = t.id === selectedId;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left px-3 py-3 hover:bg-gray-50 ${
                        active ? "bg-primary/5 border-l-2 border-primary" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm text-gray-900 truncate">
                          {t.subject}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
                        >
                          {SUPPORT_STATUS_LABELS[t.status]}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {counterpartyLabel(t)}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-2">
                        <span>{t._count.messages} msg</span>
                        <span>·</span>
                        <span>{fmtRelative(t.lastMessageAt)}</span>
                        {t.assignedAdmin && (
                          <>
                            <span>·</span>
                            <span className="text-gray-500">
                              @{t.assignedAdmin.firstName || t.assignedAdmin.email.split("@")[0]}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* RIGHT PANE — thread detail */}
      <section className="flex-1 min-w-0 flex flex-col bg-white rounded-2xl border border-gray-100">
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
            Select a thread from the list, or start a new one.
          </div>
        ) : !detail || loadingDetail && !detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
            Loading…
          </div>
        ) : (
          <ThreadDetailPane
            thread={detail}
            onChanged={async () => {
              await Promise.all([
                fetchList(),
                fetchDetail(detail.id),
              ]);
            }}
            messagesEndRef={messagesEndRef}
          />
        )}
      </section>

      {showNew && (
        <NewThreadModal onClose={() => setShowNew(false)} onCreated={onCreated} />
      )}
    </div>
  );
}

function ThreadDetailPane({
  thread,
  onChanged,
  messagesEndRef,
}: {
  thread: ThreadDetail;
  onChanged: () => Promise<void>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [composerText, setComposerText] = useState("");
  const [asInternalNote, setAsInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onPickFiles(files: FileList | null) {
    if (!files) return;
    const next = [...pending];
    for (const f of Array.from(files)) {
      if (next.length >= 5) {
        toast.error("Max 5 attachments per message");
        break;
      }
      next.push(f);
    }
    setPending(next);
  }

  async function send() {
    const body = composerText.trim();
    if ((!body && pending.length === 0) || sending) return;
    if (!body) {
      toast.error("Write a message to send with your attachment");
      return;
    }
    setSending(true);
    try {
      const uploaded: UploadedAttachment[] = [];
      for (const file of pending) {
        try {
          const meta = await uploadSupportAttachment({
            threadId: thread.id,
            file,
            presignUrl: `/api/admin/support/threads/${thread.id}/attachments/presign`,
          });
          uploaded.push(meta);
        } catch (err) {
          throw new Error(`Failed to upload ${file.name}: ${(err as Error).message}`);
        }
      }
      const res = await fetch(
        `/api/admin/support/threads/${thread.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body,
            internalNote: asInternalNote,
            attachments: uploaded,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setComposerText("");
      setAsInternalNote(false);
      setPending([]);
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function patchThread(patch: {
    status?: SupportThreadStatusValue;
    assignedAdminId?: string | null;
  }) {
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/admin/support/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingStatus(false);
    }
  }

  const style = STATUS_STYLES[thread.status];
  const assignedLabel = thread.assignedAdmin
    ? [thread.assignedAdmin.firstName, thread.assignedAdmin.lastName].filter(Boolean).join(" ") ||
      thread.assignedAdmin.email
    : "Unassigned";

  return (
    <>
      <header className="p-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {thread.subject}
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text}`}
              >
                {SUPPORT_STATUS_LABELS[thread.status]}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {counterpartyLabel(thread)}
              {thread.entityType && thread.entityId && (
                <>
                  {" · "}
                  <span className="text-gray-600">
                    {thread.entityType.toLowerCase().replace(/_/g, " ")}: {thread.entityId.slice(0, 8)}
                  </span>
                </>
              )}
            </div>
            <div className="text-[11px] text-gray-400 mt-1">
              Opened by {thread.createdByName || thread.createdByType} · {fmtRelative(thread.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-gray-500">Status</label>
            <select
              value={thread.status}
              disabled={savingStatus}
              onChange={(e) =>
                patchThread({
                  status: e.target.value as SupportThreadStatusValue,
                })
              }
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            >
              {SUPPORT_THREAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUPPORT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-500">Assigned:</span>
          <span className="text-xs text-gray-700">{assignedLabel}</span>
          <button
            type="button"
            disabled={savingStatus}
            onClick={() =>
              patchThread({
                assignedAdminId: thread.assignedAdminId ? null : "self",
              })
            }
            className="text-xs text-primary hover:underline"
          >
            {thread.assignedAdminId ? "Unassign" : "Claim"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
        {thread.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-100 p-3">
        {pending.length > 0 && (
          <div className="mb-2 space-y-1">
            {pending.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-2 py-1 text-[11px]"
              >
                <div className="min-w-0 flex items-center gap-1.5">
                  <Icon icon="solar:paperclip-linear" className="w-3.5 h-3.5 text-gray-500" />
                  <span className="truncate text-gray-800">{f.name}</span>
                  <span className="text-gray-400 shrink-0">{humanFileSize(f.size)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-500"
                  aria-label="Remove"
                >
                  <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={asInternalNote ? "Internal note (only admins see this)…" : "Reply to the thread…"}
          rows={3}
          className={`w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none ${
            asInternalNote
              ? "border-amber-300 bg-amber-50/50 focus:border-amber-400"
              : "border-gray-200 focus:border-primary"
          }`}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={asInternalNote}
                onChange={(e) => setAsInternalNote(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              Internal note (only admins)
            </label>
            <label className="inline-flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-primary">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="hidden"
              />
              <Icon icon="solar:paperclip-linear" className="w-4 h-4" />
              Attach
            </label>
          </div>
          <button
            type="button"
            onClick={send}
            disabled={sending || (!composerText.trim() && pending.length === 0)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? "Sending…" : asInternalNote ? "Save note" : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isAdmin = message.senderType === "ADMIN";
  const isSystem = message.senderType === "SYSTEM";

  if (isSystem) {
    return (
      <div className="text-center text-[11px] text-gray-400 my-2">
        {message.body} · {fmtRelative(message.createdAt)}
      </div>
    );
  }

  const align = isAdmin ? "items-end" : "items-start";
  const bubble = message.internalNote
    ? "bg-amber-100 border border-amber-200 text-amber-900"
    : isAdmin
      ? "bg-primary text-white"
      : "bg-white border border-gray-200 text-gray-900";

  return (
    <div className={`flex flex-col ${align}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${bubble}`}>
        {message.body}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.attachments.map((a) => (
              <a
                key={a.id}
                href={a.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ${
                  isAdmin && !message.internalNote
                    ? "bg-primary/80 hover:bg-primary text-white"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-900"
                }`}
              >
                <Icon icon="solar:paperclip-linear" className="w-3 h-3 shrink-0" />
                <span className="truncate">{a.fileName}</span>
                <span className={`shrink-0 ${isAdmin && !message.internalNote ? "text-white/70" : "text-gray-500"}`}>
                  {humanFileSize(a.sizeBytes)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1">
        {message.internalNote && (
          <span className="text-amber-700 font-medium">Internal ·</span>
        )}
        <span>{message.senderName || message.senderType}</span>
        <span>·</span>
        <span>{fmtRelative(message.createdAt)}</span>
      </div>
    </div>
  );
}

function NewThreadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [counterparty, setCounterparty] = useState<"MERCHANT" | "SUPPLIER">("MERCHANT");
  const [tenantId, setTenantId] = useState("");
  const [tenantResults, setTenantResults] = useState<
    { id: string; name: string; businessType: string }[]
  >([]);
  const [tenantSearch, setTenantSearch] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [saving, setSaving] = useState(false);

  // Type-ahead search against /api/admin/tenants. Debounced to keep
  // Aurora from getting hit on every keystroke.
  useEffect(() => {
    const q = tenantSearch.trim();
    if (!q) {
      setTenantResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/tenants?search=${encodeURIComponent(q)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          tenants: { id: string; name: string; businessType: string }[];
        };
        setTenantResults(data.tenants.slice(0, 8));
      } catch {
        // silent — the input is a text field, user can paste an ID
      }
    }, 250);
    return () => clearTimeout(t);
  }, [tenantSearch]);

  async function submit() {
    if (!subject.trim() || !firstMessage.trim() || !tenantId.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/support/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          firstMessage: firstMessage.trim(),
          merchantTenantId: counterparty === "MERCHANT" ? tenantId.trim() : null,
          supplierTenantId: counterparty === "SUPPLIER" ? tenantId.trim() : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { thread: { id: string } };
      onCreated(data.thread.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New support thread</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Subject</label>
            <input
              type="text"
              maxLength={255}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              placeholder="e.g. KYB doc expired, need reupload"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700">Counterparty</label>
            <div className="mt-1 flex gap-2">
              {(["MERCHANT", "SUPPLIER"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCounterparty(c);
                    setTenantId("");
                    setTenantSearch("");
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    counterparty === c
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {c === "MERCHANT" ? "Merchant" : "Supplier"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700">
              {counterparty === "MERCHANT" ? "Merchant" : "Supplier"} tenant
            </label>
            <input
              type="text"
              value={tenantSearch}
              onChange={(e) => {
                setTenantSearch(e.target.value);
                setTenantId("");
              }}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              placeholder="Type to search by name or slug"
            />
            {tenantResults.length > 0 && !tenantId && (
              <ul className="mt-1 border border-gray-100 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {tenantResults.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setTenantId(t.id);
                        setTenantSearch(t.name);
                        setTenantResults([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900">{t.name}</div>
                      <div className="text-[11px] text-gray-500">{t.businessType}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tenantId && (
              <div className="mt-1 text-[11px] text-emerald-700">
                Selected: {tenantId}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700">First message</label>
            <textarea
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              placeholder="Explain what's needed…"
            />
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !subject.trim() || !firstMessage.trim() || !tenantId.trim()}
            className="rounded-xl bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating…" : "Open thread"}
          </button>
        </div>
      </div>
    </div>
  );
}
