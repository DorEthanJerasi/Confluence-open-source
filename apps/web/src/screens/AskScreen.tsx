// The /ask screen (docs/done-checks/04-ai.md, 4d). One question field and a
// button; the answer comes back as plain text and is rendered as text nodes.
// Only the [n] markers the server listed in `sources` become links, and every
// link is built from that list, never from the answer text. Nothing here is
// ever inserted as raw HTML (same rule as search snippets and the summary).
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ASK_NO_SOURCES_ANSWER, splitAnswer, type AskReply } from '@stillwater/shared';
import { api, ApiFailure } from '../api';
import { AI_UNAVAILABLE_LINE, useAiStatus } from '../ai/SummaryCard';
import { ErrorNote, Loading } from '../ui';

const QUESTION_MAX = 500;

function sourceLabel(s: { title: string; spaceName: string }) {
  return `${s.title || 'Untitled'}, in ${s.spaceName}`;
}

function NotSetUp() {
  return (
    <div className="empty fade-in ask-off">
      <p className="empty-title">AI is not set up on this wiki</p>
      <p className="muted">Whoever hosts this wiki can turn it on by adding an AI key. Search still finds every page you can see.</p>
    </div>
  );
}

function Answer({ reply }: { reply: AskReply }) {
  const none = reply.sources.length === 0;
  return (
    <section className="ask-answer fade-in" aria-label="Answer">
      <p className={none ? 'ask-answer-text muted' : 'ask-answer-text'}>
        {none
          ? reply.answer || ASK_NO_SOURCES_ANSWER
          : splitAnswer(reply.answer, reply.sources).map((part, i) =>
              part.source ? (
                <Link
                  key={i}
                  to={part.source.url}
                  className="ask-cite"
                  aria-label={`Source ${part.source.n}: ${sourceLabel(part.source)}`}
                  title={sourceLabel(part.source)}
                >
                  {part.text}
                </Link>
              ) : (
                <Fragment key={i}>{part.text}</Fragment>
              ),
            )}
      </p>
      {!none && (
        <div className="ask-sources">
          <h2 className="ask-sources-title">Sources</h2>
          <ol className="ask-sources-list">
            {reply.sources.map((s) => (
              <li key={s.n}>
                <Link to={s.url} className="ask-source">
                  <span className="ask-source-n" aria-hidden="true">
                    [{s.n}]
                  </span>
                  <span className="ask-source-title">{s.title || 'Untitled'}</span>
                  <span className="ask-source-space">{s.spaceName}</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export function AskScreen() {
  const status = useAiStatus();
  const [question, setQuestion] = useState('');
  const ask = useMutation({ mutationFn: (q: string) => api.ask(q) });

  if (status.isPending) return <Loading />;

  const err = ask.error;
  const aiOff = !status.data?.enabled || (err instanceof ApiFailure && err.status === 404 && err.code === 'ai_off');
  const unavailable = err instanceof ApiFailure && err.status === 502;
  const trimmed = question.trim();

  return (
    <main className="content fade-in">
      <div className="page-head page-head-top">
        <div>
          <h1 className="page-title">Ask</h1>
          <p className="muted">Ask a question and get an answer from the pages you can see, with links to where it came from.</p>
        </div>
      </div>
      {aiOff ? (
        <NotSetUp />
      ) : (
        <>
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (trimmed && !ask.isPending) ask.mutate(trimmed);
            }}
          >
            <input
              type="text"
              className="input ask-input"
              aria-label="Your question"
              placeholder="What would you like to know?"
              value={question}
              maxLength={QUESTION_MAX}
              autoFocus
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!trimmed || ask.isPending}>
              {ask.isPending ? 'Asking…' : 'Ask'}
            </button>
          </form>
          <div aria-live="polite" aria-busy={ask.isPending}>
            {ask.isPending ? (
              <div className="ask-loading fade-in">
                <span className="loading-dot" aria-hidden="true" />
                <span className="muted">Reading your pages…</span>
              </div>
            ) : unavailable ? (
              <p className="ask-answer-text muted fade-in">{AI_UNAVAILABLE_LINE}</p>
            ) : err ? (
              <ErrorNote error={err} />
            ) : ask.data ? (
              <Answer key={ask.submittedAt} reply={ask.data} />
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}
