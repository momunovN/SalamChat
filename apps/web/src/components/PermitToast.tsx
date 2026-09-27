export function PermitToast({
  title,
  body,
  allowLabel,
  cancelLabel,
  onAllow,
  onCancel,
}: {
  title: string;
  body: string;
  allowLabel: string;
  cancelLabel: string;
  onAllow: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex justify-center px-4"
      style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-elevated px-4 py-3 text-ink shadow-lg" role="dialog" aria-live="polite">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted">{body}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-2 text-sm font-semibold text-muted">
            {cancelLabel}
          </button>
          <button type="button" onClick={onAllow} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">
            {allowLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
