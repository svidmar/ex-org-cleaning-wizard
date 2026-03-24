import type { ReactNode } from "react";

export function ConfirmModal({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="mx-4 w-full max-w-lg rounded-xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        <h3 className="px-6 pt-6 pb-4 text-lg font-semibold text-gray-900 shrink-0">{title}</h3>
        <div className="px-6 text-sm text-gray-700 overflow-y-auto min-h-0">{children}</div>
        <div className="px-6 pt-4 pb-6 flex justify-end gap-3 shrink-0">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-[#211a52] px-4 py-2 text-sm font-medium text-white hover:bg-[#594fbf]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
