/**
 * Where a key gets pasted.
 *
 * This is the one screen that takes the office from replaying recorded work to
 * doing real work, so it says plainly where the key goes and never shows it back.
 * The field is write-only on purpose: an office that can display your key is an
 * office that can leak it.
 */
import { type ReactElement, useEffect, useState } from "react";

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

export function Settings({
  mode,
  states,
  onSave,
  onClose,
}: {
  mode: "live" | "demo";
  states: Record<string, SaveState>;
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
      </div>
    </aside>
  );
}
