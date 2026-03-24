import { useState, useCallback } from "react";
import { cn } from "./utils";

export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastItem["type"] = "info") => {
      const id = ++toastId;
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    },
    []
  );

  return { toasts, addToast };
}

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium shadow-lg",
            t.type === "success" && "bg-[#0e8563] text-white",
            t.type === "error" && "bg-[#cc445b] text-white",
            t.type === "info" && "bg-[#211a52] text-white"
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
