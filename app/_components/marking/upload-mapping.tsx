"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { Check, FileImage, Loader2, Upload } from "lucide-react";

import { runOcr, setResponsePageMapping, uploadResponsePage } from "@/features/papers/client";

type Page = {
  id: string; file: File; preview?: string; questionKeys: string[]; uploadedKeys?: string[];
  pageId?: string; status: "queued" | "uploading" | "uploaded" | "error"; error?: string; invalid?: boolean;
};
const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const sameKeys = (left: string[], right: string[]) => left.length === right.length && left.every((key) => right.includes(key));

export function UploadMapping({ submissionId, questions, initiallyOpen, onChange }: {
  submissionId: string; questions: Array<{ key: string; label: string }>; initiallyOpen: boolean; onChange: () => void;
}) {
  const inputId = useId();
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [processed, setProcessed] = useState<Set<string>>(() => new Set());
  const [reading, setReading] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const previews = useRef(new Set<string>());
  const dirty = (page: Page) => Boolean(page.pageId && !sameKeys(page.questionKeys, page.uploadedKeys ?? []));
  const uploaded = pages.filter((page) => page.status === "uploaded" && !dirty(page));
  const unreadKeys = Array.from(new Set(uploaded.flatMap((page) => page.questionKeys))).filter((key) => !processed.has(key));
  const candidates = pages.filter((page) => !page.pageId && !page.invalid && page.questionKeys.length && page.status !== "uploaded");
  const incomplete = pages.some((page) => !page.pageId || dirty(page));

  useEffect(() => {
    const urls = previews.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);
  useEffect(() => {
    if (!incomplete) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [incomplete]);

  const update = (id: string, patch: Partial<Page>) => setPages((current) => current.map((page) => page.id === id ? { ...page, ...patch } : page));
  const invalidate = (keys: string[]) => setProcessed((current) => new Set([...current].filter((key) => !keys.includes(key))));

  const choose = async (files: File[]) => {
    setBusy(true);
    const added: Page[] = [];
    const ids = new Set(pages.map((page) => page.id));
    try {
      for (const file of files.slice(0, Math.max(0, 40 - pages.length))) {
        const error = !supportedTypes.has(file.type) ? "Use a JPG, PNG, WebP or GIF image." : !file.size ? "This file is empty." : file.size > 10 * 1024 * 1024 ? "Choose an image smaller than 10 MB." : undefined;
        const id = error ? crypto.randomUUID() : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (ids.has(id)) { setAnnouncement(`${file.name} is already selected.`); continue; }
        ids.add(id);
        const preview = error ? undefined : URL.createObjectURL(file);
        if (preview) previews.current.add(preview);
        added.push({ id, file, preview, questionKeys: [], status: error ? "error" : "queued", error, invalid: Boolean(error) });
      }
      setPages((current) => [...current, ...added]);
      if (files.length + pages.length > 40) setAnnouncement("Choose up to 40 pages at a time.");
    } catch {
      setAnnouncement("Could not read these files. Please choose them again.");
    } finally { setBusy(false); }
  };

  const save = async (page: Page) => {
    update(page.id, { status: "uploading", error: undefined });
    try {
      let pageId = page.pageId;
      let questionKeys: string[];
      if (pageId) {
        questionKeys = (await setResponsePageMapping({ submissionId, pageId, questionKeys: page.questionKeys })).questionKeys;
      } else {
        const body = new FormData();
        body.append("submissionId", submissionId);
        body.append("questionKey", page.questionKeys[0]);
        for (const key of page.questionKeys) body.append("questionKeys", key);
        body.append("file", page.file);
        const result = await uploadResponsePage(body);
        pageId = result.pageId;
        questionKeys = result.questionKeys;
      }
      invalidate([...page.questionKeys, ...(page.uploadedKeys ?? [])]);
      update(page.id, { pageId, questionKeys, uploadedKeys: questionKeys, status: "uploaded" });
      onChange();
    } catch (error) {
      update(page.id, { status: "error", error: error instanceof Error ? error.message : "Could not upload this page. Try again." });
    }
  };

  const remove = async (page: Page) => {
    if (page.pageId && !window.confirm("Remove this page from the attempt? Existing marks may need review.")) return;
    setBusy(true);
    try {
      if (page.pageId) {
        await setResponsePageMapping({ submissionId, pageId: page.pageId, questionKeys: [] });
        invalidate(page.uploadedKeys ?? []);
        onChange();
      }
      if (page.preview) { URL.revokeObjectURL(page.preview); previews.current.delete(page.preview); }
      setPages((current) => current.filter((entry) => entry.id !== page.id));
    } catch (error) {
      update(page.id, { error: error instanceof Error ? error.message : "Could not remove this page." });
    } finally { setBusy(false); }
  };

  const uploadAll = async () => {
    setBusy(true);
    try { for (const page of candidates) await save(page); }
    finally { setBusy(false); }
  };

  const readAnswers = async () => {
    setBusy(true);
    try {
      for (const key of unreadKeys) {
        setReading(key);
        setReadErrors((current) => ({ ...current, [key]: "" }));
        try {
          await runOcr({ submissionId, questionKey: key });
          setProcessed((current) => new Set(current).add(key));
        } catch (error) {
          setReadErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "Could not read this answer. Try again." }));
        }
      }
      onChange();
    } finally { setReading(null); setBusy(false); }
  };

  return <details open={initiallyOpen || pages.length > 0} className="border-b border-text/15 pb-4">
    <summary className="min-h-11 cursor-pointer py-3 text-base font-semibold text-text">{initiallyOpen ? "Add answer pages" : "Add more answer pages"} {pages.length > 0 ? <span className="ml-2 text-sm font-normal text-text-secondary">{uploaded.length} of {pages.length} uploaded</span> : null}</summary>
    <div className="space-y-4 pt-2">
      <p className="max-w-prose text-sm leading-6 text-text-secondary">Choose the questions shown on each page before reading the answers. A page can cover more than one question.</p>
      <label htmlFor={inputId} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 border border-accent px-4 text-sm font-semibold text-accent focus-within:outline-2 focus-within:outline-offset-2 ${busy ? "pointer-events-none opacity-50" : "hover:bg-accent-soft"}`}>
        <Upload className="h-4 w-4" aria-hidden="true" />Choose answer images
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={busy} className="sr-only" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void choose(files); }} />
      </label>
      <p role="status" className="text-sm text-text-secondary">{announcement}</p>
      <ul className="divide-y divide-text/15">
        {pages.map((page) => {
          const ready = page.status === "uploaded" && !dirty(page);
          const readError = page.questionKeys.map((key) => readErrors[key]).find(Boolean);
          const allRead = ready && page.questionKeys.every((key) => processed.has(key));
          return <li key={page.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-4 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
            <div className="flex items-start justify-center bg-bg-soft">{page.preview ? <Image src={page.preview} width={96} height={128} unoptimized alt={`Preview of ${page.file.name}`} className="max-h-32 object-contain" /> : <FileImage className="my-5 h-7 w-7 text-text-secondary" aria-hidden="true" />}</div>
            <div className="min-w-0 space-y-2">
              <p className="break-words text-sm font-semibold text-text">{page.file.name}</p>
              {!page.invalid ? questions.length ? <details className="border border-text/20">
                <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm text-text">{page.questionKeys.length ? page.questionKeys.map((key) => questions.find((question) => question.key === key)?.label ?? key).join(", ") : "Choose questions"}</summary>
                <fieldset disabled={busy} className="grid max-h-64 grid-cols-1 overflow-y-auto border-t border-text/15 p-2 sm:grid-cols-2">
                  <legend className="sr-only">Questions for {page.file.name}</legend>
                  {questions.map((question) => <label key={question.key} className="flex min-h-11 cursor-pointer items-center gap-3 px-2 text-sm text-text"><input type="checkbox" checked={page.questionKeys.includes(question.key)} onChange={(event) => update(page.id, { questionKeys: event.target.checked ? [...page.questionKeys, question.key] : page.questionKeys.filter((key) => key !== question.key) })} className="h-4 w-4 accent-accent" />{question.label}</label>)}
                </fieldset>
              </details> : <label className="block text-sm text-text-secondary">Question reference<input value={page.questionKeys[0] ?? ""} disabled={busy} maxLength={120} placeholder="For example, 1(a)" onChange={(event) => update(page.id, { questionKeys: event.target.value.trim() ? [event.target.value] : [] })} className="mt-1 min-h-11 w-full border border-text/20 bg-white px-3 text-base text-text" /></label> : null}
              {page.error || readError ? <p role="alert" className="text-sm text-danger">{page.error || readError}</p> : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {page.status === "uploading" ? <span role="status" className="inline-flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Uploading</span> : ready ? <span role="status" className="inline-flex items-center gap-1 text-sm text-success"><Check className="h-4 w-4" aria-hidden="true" />{reading && page.questionKeys.includes(reading) ? "Reading answers" : allRead ? "Answers ready" : "Uploaded"}</span> : null}
                {(page.status === "error" || dirty(page)) && !page.invalid ? <button type="button" disabled={busy || !page.questionKeys.length} onClick={async () => { setBusy(true); try { await save(page); } finally { setBusy(false); } }} className="min-h-11 text-sm font-semibold text-accent disabled:opacity-50">{page.pageId ? "Save questions" : "Retry upload"}</button> : null}
                <button type="button" disabled={busy} onClick={() => void remove(page)} className="min-h-11 text-sm font-semibold text-text-secondary underline underline-offset-4 disabled:opacity-50">{page.pageId ? "Remove from attempt" : "Remove"}</button>
              </div>
            </div>
          </li>;
        })}
      </ul>
      {pages.length > 0 ? <div className="flex flex-wrap gap-3">
        {candidates.length > 0 ? <button type="button" disabled={busy || pages.some((page) => !page.invalid && !page.questionKeys.length)} onClick={() => void uploadAll()} className="min-h-11 bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">Upload mapped pages</button> : null}
        {uploaded.length > 0 ? <button type="button" disabled={busy || !unreadKeys.length || pages.some(dirty)} onClick={() => void readAnswers()} className="min-h-11 border border-accent px-4 text-sm font-semibold text-accent disabled:opacity-50">{reading ? "Reading answers" : unreadKeys.length ? "Read uploaded answers" : "Answers ready"}</button> : null}
      </div> : null}
    </div>
  </details>;
}
