/**
 * Where a key gets pasted.
 *
 * This is the one screen that takes the office from replaying recorded work to
 * doing real work, so it says plainly where the key goes and never shows it back.
 * The field is write-only on purpose: an office that can display your key is an
 * office that can leak it.
 */
import type { RoutineView } from "@staffroom/core";
import { type ReactElement, useEffect, useState } from "react";
import { Routines, type RoutinesProps } from "./Routines.js";

export interface ProviderRow {
  id: string;
  name: string;
  /** What the field is asking for: a key for most, a base URL for Ollama. */
  secret: "key" | "url";
  placeholder: string;
  note: string;
}

export const PROVIDERS: ProviderRow[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    secret: "key",
    placeholder: "sk-ant-…",
    note: "Claude models.",
  },
  {
    id: "openai",
    name: "OpenAI",
    secret: "key",
    placeholder: "sk-…",
    note: "Also works for Groq, Together, OpenRouter and LM Studio.",
  },
  {
    id: "ollama",
    name: "Ollama",
    secret: "url",
    placeholder: "http://127.0.0.1:11434",
    note: "Runs on this machine. No key needed.",
  },
];

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string; hint: string };

function Row({
  provider,
  state,
  onSave,
}: {
  provider: ProviderRow;
  state: SaveState;
  onSave: (value: string) => void;
}): ReactElement {
  const [value, setValue] = useState("");
  const label = provider.secret === "key" ? "Paste an API key" : "Base URL";

  return (
    <div className="setting-row">
      <div className="setting-head">
        <h3 className="setting-name">{provider.name}</h3>
        <p className="setting-note">{provider.note}</p>
      </div>

      <div className="setting-field">
        <input
          type={provider.secret === "key" ? "password" : "text"}
          className="setting-input"
          value={value}
          placeholder={provider.placeholder}
          aria-label={`${label} for ${provider.name}`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim().length > 0) onSave(value.trim());
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={value.trim().length === 0 || state.kind === "saving"}
          onClick={() => onSave(value.trim())}
        >
          {state.kind === "saving" ? "Saving…" : "Save"}
        </button>
      </div>

      {state.kind === "saved" && (
        <p className="setting-ok" role="status">
          Saved to office/.env.
        </p>
      )}

      {state.kind === "failed" && (
        <p className="setting-bad" role="alert">
          {state.message}
          <span className="setting-hint">{state.hint}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The one-off question about the sample business.
 *
 * Two plain buttons and no default focus. It is the only destructive-sounding
 * thing on this screen, and a card that can be dismissed by pressing Enter on
 * the way past is not asking a question, it is collecting a keystroke.
 *
 * "Keep them" is a real answer, not a dismissal: the office writes it down and
 * stops asking either way, which is the difference between a choice and a
 * reminder that comes back.
 */
function SampleCard({
  question,
  busy,
  onAnswer,
}: {
  question: string;
  busy: boolean;
  onAnswer: (remove: boolean) => void;
}): ReactElement {
  return (
    <section className="setting-row sample-card" aria-label="Sample content">
      <p className="sample-question">{question}</p>
      <p className="setting-note">
        They move to 90-archive/_sample/ in your office folder, so your staff stop reading them.
        Nothing is deleted from disk.
      </p>
      <div className="sample-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => onAnswer(true)}>
          {busy ? "Removing…" : "Remove them"}
        </button>
        <button type="button" className="btn-quiet" disabled={busy} onClick={() => onAnswer(false)}>
          Keep them
        </button>
      </div>
    </section>
  );
}

export function Settings({
  mode,
  states,
  routines,
  routineActions,
  sampleQuestion,
  sampleBusy,
  onAnswerSamples,
  onSave,
  onClose,
}: {
  mode: "live" | "demo";
  states: Record<string, SaveState>;
  routines: RoutineView[];
  routineActions: Omit<RoutinesProps, "routines">;
  /** SR-066: the open question, or null once it has been answered. */
  sampleQuestion?: string | null;
  sampleBusy?: boolean;
  onAnswerSamples?: (remove: boolean) => void;
  onSave: (providerId: string, value: string) => void;
  onClose: () => void;
}): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="sheet" aria-label="Settings">
      <header className="sheet-head">
        <h2 className="settings-title">Models</h2>
        <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close settings">
          Close
        </button>
      </header>

      <div className="sheet-scroll">
        {mode === "demo" && (
          <p className="settings-lede">
            No model is connected, so the office is replaying recorded work. Paste a key below and
            it will do the real thing.
          </p>
        )}

        {/* Above the key fields, because it is about the office they are looking
            at now rather than the one they are configuring next. */}
        {sampleQuestion !== null &&
          sampleQuestion !== undefined &&
          onAnswerSamples !== undefined && (
            <SampleCard
              question={sampleQuestion}
              busy={sampleBusy === true}
              onAnswer={onAnswerSamples}
            />
          )}

        {PROVIDERS.map((provider) => (
          <Row
            key={provider.id}
            provider={provider}
            state={states[provider.id] ?? { kind: "idle" }}
            onSave={(value) => onSave(provider.id, value)}
          />
        ))}

        <p className="settings-foot">
          Keys are saved to office/.env, a hidden file in your office folder. Staffroom never sends
          them anywhere else, and never shows them back to you.
        </p>
        <p className="settings-foot">
          The office reads keys when it starts, so restart it to begin using one.
        </p>

        {/* Unattended work is the part of this that happens while nobody is
            looking, so it is listed where somebody can turn it off. */}
        <h3 className="settings-heading">Routines</h3>
        <Routines routines={routines} {...routineActions} />
      </div>
    </aside>
  );
}
