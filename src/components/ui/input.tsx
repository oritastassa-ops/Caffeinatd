import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { controlClasses, describedBy } from "./styles";

/**
 * Shared label + control + message layout. The control (input/select/textarea)
 * is passed in as children so each variant keeps its own element and props.
 */
function FieldShell({
  id,
  label,
  hint,
  error,
  messageId,
  className,
  children,
}: {
  id?: string;
  label?: string;
  hint?: string;
  error?: string;
  messageId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-text-dim">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={messageId} className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-text-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * These controls stay presentational (no hooks) so forms can render them in
 * server components. The a11y id is taken from `id ?? name`; pass one for the
 * label and hint to associate. Focus ring and error state come from the shared
 * control classes.
 */

type FieldExtras = {
  label?: string;
  hint?: string;
  error?: string;
  /** Class for the wrapping column, not the control (use `className` for that). */
  containerClassName?: string;
};

export function Input({
  label,
  hint,
  error,
  id,
  name,
  className,
  containerClassName,
  ...rest
}: ComponentProps<"input"> & FieldExtras) {
  const controlId = id ?? name;
  const { describedById, messageId } = describedBy(controlId, Boolean(hint), Boolean(error));
  return (
    <FieldShell
      id={controlId}
      label={label}
      hint={hint}
      error={error}
      messageId={messageId}
      className={containerClassName}
    >
      <input
        id={controlId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={controlClasses(Boolean(error), className)}
        {...rest}
      />
    </FieldShell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  id,
  name,
  className,
  containerClassName,
  ...rest
}: ComponentProps<"textarea"> & FieldExtras) {
  const controlId = id ?? name;
  const { describedById, messageId } = describedBy(controlId, Boolean(hint), Boolean(error));
  return (
    <FieldShell
      id={controlId}
      label={label}
      hint={hint}
      error={error}
      messageId={messageId}
      className={containerClassName}
    >
      <textarea
        id={controlId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={controlClasses(Boolean(error), cn("min-h-20 resize-y", className))}
        {...rest}
      />
    </FieldShell>
  );
}

export function Select({
  label,
  hint,
  error,
  id,
  name,
  className,
  containerClassName,
  children,
  ...rest
}: ComponentProps<"select"> & FieldExtras) {
  const controlId = id ?? name;
  const { describedById, messageId } = describedBy(controlId, Boolean(hint), Boolean(error));
  return (
    <FieldShell
      id={controlId}
      label={label}
      hint={hint}
      error={error}
      messageId={messageId}
      className={containerClassName}
    >
      <select
        id={controlId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
        className={controlClasses(Boolean(error), className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}
