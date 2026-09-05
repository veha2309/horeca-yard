import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, Package } from 'lucide-react';
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="/" className={`logo ${light ? 'light' : ''}`} aria-label="Horeca Yard home">
      <span className="logo-mark">
        H<span>Y</span>
      </span>
      <span>
        <b>HORECA YARD</b>
        <small>WHOLESALE PARTNER</small>
      </span>
    </a>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Package size={36} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Loading…
    </div>
  );
}
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className={`badge status-${String(children).toLowerCase().replaceAll(' ', '-')}`}>
      {children}
    </span>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
