// AI summarise on the page screen (done-check 04, 4b). The button shows only
// when the host has AI on; the card sits above the page body and shows the
// summary as plain text (a React text node, never HTML).
import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, ApiFailure } from '../api';
import { ErrorNote } from '../ui';

export const aiStatusKey = ['ai', 'status'] as const;

/** The /api/ai/status query. Fetched once per app load and cached. */
export function useAiStatus() {
  return useQuery({
    queryKey: aiStatusKey,
    queryFn: api.aiStatus,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** True only when the server says AI is on. */
export function useAiEnabled(): boolean {
  return useAiStatus().data?.enabled === true;
}

export const AI_UNAVAILABLE_LINE = 'AI is not available right now. Try again in a moment.';

export function SummaryCard({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const summary = useMutation({ mutationFn: () => api.summarisePage(pageId) });
  const { mutate } = summary;

  // Ask once when the card opens (the ref stops React's dev double-run from
  // calling the provider twice); pressing Summarise again mounts a fresh card.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    mutate();
  }, [mutate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const err = summary.error;
  const unavailable = err instanceof ApiFailure && err.status === 502;

  return (
    <section className="summary-card fade-in" aria-label="Page summary" aria-busy={summary.isPending}>
      <div className="summary-head">
        <h2 className="summary-title">Summary</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close summary" title="Close">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div aria-live="polite">
        {summary.isPending || summary.isIdle ? (
          <div className="summary-loading">
            <span className="loading-dot" aria-hidden="true" />
            <span className="muted">Summarising…</span>
          </div>
        ) : unavailable ? (
          <p className="summary-text muted">{AI_UNAVAILABLE_LINE}</p>
        ) : err ? (
          <ErrorNote error={err} />
        ) : (
          <p className="summary-text">{summary.data?.summary}</p>
        )}
      </div>
    </section>
  );
}
