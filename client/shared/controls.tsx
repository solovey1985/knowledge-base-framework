import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: string;
  loading?: boolean;
};

/** Icon names are complete CSS classes so Tailwind can discover them at build time. */
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={`kb-icon ${name} ${className}`} />;
}

export function Button({ variant = 'secondary', className = '', icon, loading, disabled, children, ...props }: ButtonProps) {
  return (
    <button type="button" className={`kb-button kb-button-${variant} ${className}`}
      disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Icon name="icon-[lucide--loader-circle]" className="motion-safe:animate-spin" /> : icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function IconButton({ label, className = '', ...props }: Omit<ButtonProps, 'children'> & { label: string; icon: string }) {
  return <Button {...props} className={`kb-icon-button ${className}`} aria-label={label} title={label} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span>{label}</span>{children}</label>;
}
