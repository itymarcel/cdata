import { useEffect, useRef, type ReactNode } from "react";
import "./components.css";

/** Accessible dialog built on <dialog>: focus trapping and Esc come free. */
export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="modal__header">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="modal__body">{open && children}</div>
    </dialog>
  );
}
