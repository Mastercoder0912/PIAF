interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
  hint?: string;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "numeric";
}

/** Labelled text input with an optional hint and red validation messages. */
export function TextField({
  id,
  label,
  value,
  onChange,
  errors,
  hint,
  placeholder,
  inputMode = "text",
}: TextFieldProps) {
  const hasError = errors !== undefined && errors.length > 0;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="field">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <div id={errorId} className="field-error" role="alert">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
