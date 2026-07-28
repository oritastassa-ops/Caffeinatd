import Link from "next/link";
import type { ComponentProps } from "react";
import { ButtonSize, ButtonVariant, buttonClasses, buttonState } from "./styles";

/** Inline spinner — a bare ring, no coffee motif, so it reads at button scale. */
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

/**
 * The app's one button. Presentational (no hooks), so it works in server
 * components and forms alike. `loading` implies disabled — see buttonState.
 * Renders `ref` and unknown props straight through to the <button>.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const state = buttonState({ disabled, loading });
  return (
    <button
      className={buttonClasses(variant, size, className)}
      disabled={state.disabled}
      aria-busy={state.ariaBusy || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type LinkButtonProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * A <Link> that looks like a Button — for navigations that were being
 * hand-styled as buttons (Connect, Manage). Same class vocabulary as Button.
 */
export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
