import { useState, useRef, useCallback } from 'react';

export function useToast() {
    const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: '' });
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        setToast({ show: true, message });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(t => ({ ...t, show: false })), 1800);
    }, []);

    const node = toast.show ? (
        <div className="os-toast">
            <span aria-hidden="true">✓</span>
            {toast.message}
        </div>
    ) : null;

    return { showToast, toastNode: node };
}
