import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// How long a toast stays up, by severity.
//
// Sonner exposes only ONE duration at the provider (ToasterProps.duration,
// and toastOptions.duration is the same global default) -- there is no
// per-type override in the component API. The provider therefore sets the
// success/info/default figure, and errors are lifted here instead.
//
// Done by wrapping toast.error once, at module scope, rather than by
// passing a duration at each of the ~60 call sites: a caller that
// already specifies its own duration keeps it (spread last), everything
// else gets long enough to actually be read. This is the only place in
// the app that knows these numbers.
const DEFAULT_DURATION_MS = 3000;
const ERROR_DURATION_MS = 6000;

// IMPORTANT: this patch only takes effect if this module is actually
// evaluated. package.json sets "sideEffects": false, so the bundler is
// free to drop a module whose exports nobody uses. It survives today
// because __root.tsx imports BOTH Toaster and DEFAULT_DURATION_MS from
// here. If the Toaster is ever moved elsewhere, or that constant is
// inlined, every error toast quietly reverts to the 3s default with no
// build error and nothing at the ~60 call sites pointing back here.
//
// The flag makes re-evaluation idempotent: without it a dev-server hot
// update would re-run this body, capture the already-wrapped function
// as `baseError`, and grow one wrapper layer per edit.
type PatchedToast = typeof toast & { __pinspiderErrorDurationPatched?: boolean };
const patchable = toast as PatchedToast;
if (!patchable.__pinspiderErrorDurationPatched) {
  const baseError = toast.error;
  // `...data` last, so a caller that passes its own duration still wins.
  toast.error = ((message, data) =>
    baseError(message, { duration: ERROR_DURATION_MS, ...data })) as typeof toast.error;
  patchable.__pinspiderErrorDurationPatched = true;
}

export { DEFAULT_DURATION_MS };

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
