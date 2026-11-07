"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isGenerationTerminal, type GenerationJobSnapshot } from "@/features/papers/builder/domain/generation-job";
import { cancelPaperGenerationJob, downloadPaperGenerationFile, fetchPaperGenerationJob, PaperMakerRequestError, requestSavedPaper, startPaperGenerationJob } from "@/features/papers/builder/presentation/api-client";

type GenerationInput = Omit<Parameters<typeof startPaperGenerationJob>[0], "requestKey">;
const PENDING_REQUEST = "revise:generation-request";
const RECENT_JOB = "revise:recent-generation";
const noRecentJob = () => null;

function readRecentJob(): string | null {
  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_JOB) ?? "null");
    return typeof recent?.jobId === "string" && recent.jobId.length === 36 && recent.expiresAt > Date.now() ? recent.jobId : null;
  } catch { return null; }
}

function subscribeRecentJob(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(RECENT_JOB, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(RECENT_JOB, onChange); };
}

function requestKey(input: unknown) {
  const fingerprint = JSON.stringify(input);
  try {
    const previous = JSON.parse(sessionStorage.getItem(PENDING_REQUEST) ?? "null");
    if (previous?.fingerprint === fingerprint && typeof previous.key === "string") return previous.key as string;
  } catch {}
  const key = crypto.randomUUID();
  try { sessionStorage.setItem(PENDING_REQUEST, JSON.stringify({ fingerprint, key })); } catch {}
  return key;
}

function clearRequestKey(key: string) {
  try {
    if (JSON.parse(sessionStorage.getItem(PENDING_REQUEST) ?? "null")?.key === key) sessionStorage.removeItem(PENDING_REQUEST);
  } catch {}
}

export function usePaperGeneration(initialJobId?: string) {
  const [job, setJob] = useState<GenerationJobSnapshot | null>(null);
  const [jobId, setJobId] = useState(initialJobId ?? null);
  const recentJobId = useSyncExternalStore(subscribeRecentJob, readRecentJob, noRecentJob);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryingScheme, setRetryingScheme] = useState<number | null>(null);
  const [savedPaperIds, setSavedPaperIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const busyRef = useRef(false);
  const saveRef = useRef<Promise<string[]> | null>(null);
  const alive = useRef(true);
  const rememberedJob = useRef<string | null>(null);

  const remember = useCallback((snapshot: GenerationJobSnapshot) => {
    if (rememberedJob.current === snapshot.jobId) return;
    rememberedJob.current = snapshot.jobId;
    try { localStorage.setItem(RECENT_JOB, JSON.stringify({ jobId: snapshot.jobId, expiresAt: snapshot.expiresAt })); } catch {}
    window.dispatchEvent(new Event(RECENT_JOB));
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snapshot = await fetchPaperGenerationJob(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setJob(snapshot);
        remember(snapshot);
        setError(null);
        if (!isGenerationTerminal(snapshot.status)) timer = setTimeout(poll, 1500);
        else setStopping(false);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof PaperMakerRequestError && [403, 404, 410].includes(cause.status) && readRecentJob() === jobId) {
          try { localStorage.removeItem(RECENT_JOB); } catch {}
          window.dispatchEvent(new Event(RECENT_JOB));
        }
        setError(cause instanceof Error ? cause.message : "We could not check this paper.");
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, retry, remember]);

  useEffect(() => {
    const reconnect = () => setRetry((value) => value + 1);
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, []);

  const start = useCallback(async (input: GenerationInput) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStarting(true);
    setError(null);
    setSaveError(null);
    setSavedPaperIds([]);
    setStopping(false);
    const key = requestKey(input);
    try {
      const snapshot = await startPaperGenerationJob({ ...input, requestKey: key });
      remember(snapshot);
      clearRequestKey(key);
      if (!alive.current) return;
      setJob(snapshot);
      setJobId(snapshot.jobId);
      const url = new URL(window.location.href);
      url.searchParams.set("job", snapshot.jobId);
      window.history.pushState(null, "", url);
    } catch (cause) {
      if (cause instanceof PaperMakerRequestError && (cause.status === 403 || cause.status === 410)) {
        clearRequestKey(key);
      }
      if (alive.current) setError(cause instanceof Error ? cause.message : "We could not start this paper. Try again.");
    } finally {
      busyRef.current = false;
      if (alive.current) setStarting(false);
    }
  }, [remember]);

  const stop = useCallback(async () => {
    if (!jobId || stopping) return;
    setStopping(true);
    try {
      if (!await cancelPaperGenerationJob(jobId, job?.runVersion ?? 0)) throw new Error("We could not stop preparation. Check its status and try again.");
      setRetry((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not stop preparation.");
      setStopping(false);
    }
  }, [jobId, job, stopping]);

  const retryScheme = useCallback(async (paperIndex: number) => {
    if (!job || busyRef.current) return;
    busyRef.current = true;
    setRetryingScheme(paperIndex);
    setError(null);
    const input = { jobId: job.jobId, paperIndex, runVersion: job.runVersion ?? 0 };
    const key = requestKey(input);
    try {
      const response = await fetch("/api/paper-maker/generation-jobs/retry-scheme", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestKey: key }),
      });
      if (!response.ok) throw new PaperMakerRequestError(await response.text(), response.status);
      const snapshot = await response.json() as GenerationJobSnapshot;
      clearRequestKey(key);
      if (alive.current) { setJob(snapshot); setRetry((value) => value + 1); }
    } catch (cause) {
      if (cause instanceof PaperMakerRequestError && cause.status === 403) clearRequestKey(key);
      if (alive.current) setError(cause instanceof Error ? cause.message : "We could not retry the mark scheme.");
    } finally {
      busyRef.current = false;
      if (alive.current) setRetryingScheme(null);
    }
  }, [job]);

  const download = useCallback(async (part: string, fileName: string) => {
    if (!jobId) return;
    setError(null);
    try {
      const blob = await downloadPaperGenerationFile(jobId, part);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be opened. Please try again.");
    }
  }, [jobId]);

  const save = useCallback((): Promise<string[]> => {
    if (saveRef.current) return saveRef.current;
    if (!job || savedPaperIds.length === job.papers.length) return Promise.resolve(savedPaperIds);
    setSaving(true);
    setSaveError(null);
    const operation = (async () => {
      const response = await fetch("/api/paper-maker/generation-jobs/claim", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.jobId }),
      });
      if (!response.ok) throw new Error("Sign in again to keep this paper.");
      const ids: string[] = [];
      for (const paper of job.papers) {
        if (!paper.generationReceiptId) throw new Error("This paper could not be saved. You can still download it.");
        const blob = await downloadPaperGenerationFile(job.jobId, `paper-${paper.index}`);
        const form = new FormData();
        form.set("generationReceiptId", paper.generationReceiptId);
        form.set("file", new File([blob], paper.fileName, { type: "application/pdf" }));
        const saved = await requestSavedPaper(form);
        if (!saved.savedPaperId) throw new Error("The paper was not saved. Please try again.");
        ids.push(saved.savedPaperId);
      }
      if (alive.current) setSavedPaperIds(ids);
      return ids;
    })().catch((cause) => {
      if (alive.current) setSaveError(cause instanceof Error ? cause.message : "We could not save this paper.");
      return [];
    }).finally(() => {
      saveRef.current = null;
      if (alive.current) setSaving(false);
    });
    saveRef.current = operation;
    return operation;
  }, [job, savedPaperIds]);

  const dismiss = useCallback(() => {
    if (busyRef.current) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    window.history.replaceState(null, "", url);
    setJobId(null);
    setJob(null);
    setError(null);
    setSaveError(null);
    setSavedPaperIds([]);
  }, []);

  const resumeRecent = useCallback(() => {
    if (!recentJobId || busyRef.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set("job", recentJobId);
    window.history.pushState(null, "", url);
    setJob(null);
    setJobId(recentJobId);
    setError(null);
  }, [recentJobId]);

  return {
    job, jobId, recentJobId, starting, stopping, saving, error, saveError, savedPaperIds, retryingScheme,
    requestPending: starting || retryingScheme !== null,
    busy: starting || retryingScheme !== null || Boolean(jobId && job && !isGenerationTerminal(job.status)),
    start, stop, save, download, dismiss, resumeRecent, retryScheme, retry: () => setRetry((value) => value + 1),
  };
}
