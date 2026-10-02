import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PwdFieldProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  name?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export default function PwdField({ value, onChange, className = '', placeholder, autoFocus, autoComplete, name, onKeyDown }: PwdFieldProps) {
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Le gestionnaire de mots de passe du navigateur ignore un champ affiche en
  // clair : on force type="password" (synchronement) au moment exact du submit.
  useEffect(() => {
    const form = inputRef.current?.closest('form');
    if (!form) return;
    const onSubmit = () => {
      const i = inputRef.current;
      if (i && i.type !== 'password') i.type = 'password';
      setShow(false);
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        name={name}
        onKeyDown={onKeyDown}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        title={show ? 'Masquer' : 'Afficher'}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
