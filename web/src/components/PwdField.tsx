import { useState } from 'react';
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
  return (
    <div className="relative">
      <input
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
