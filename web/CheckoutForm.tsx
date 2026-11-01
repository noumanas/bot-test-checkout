import { useEffect, useMemo, useState } from 'react';

interface CartItem {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
}

interface Props {
  items: CartItem[];
  promoMessage: string; // from the ?promo= query string, so untrusted: rendered as text only
  onPay: (card: { number: string; exp: string; cvc: string }) => Promise<void>;
}

const EMPTY_CARD = { number: '', exp: '', cvc: '' };

export function CheckoutForm({ items, promoMessage, onPay }: Props) {
  // Card details live only in memory for this form; they're never persisted.
  const [card, setCard] = useState(EMPTY_CARD);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0), [items]);

  // Earlier versions saved the card to localStorage; remove anything left behind.
  useEffect(() => {
    try {
      localStorage.removeItem('checkout-card');
    } catch {
      // storage unavailable (private mode): nothing to clean up
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (paying) return;
    setPaying(true);
    setError(null);
    try {
      await onPay(card);
      // Analytics gets the amount only — never card details.
      void fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'checkout_paid', totalCents: total }),
      }).catch(() => undefined);
      setCard(EMPTY_CARD);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {promoMessage && <div className="promo">{promoMessage}</div>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} × {item.quantity}
          </li>
        ))}
      </ul>
      <p>Total: ${(total / 100).toFixed(2)}</p>
      <input
        value={card.number}
        onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))}
        placeholder="Card number"
        autoComplete="cc-number"
        inputMode="numeric"
        required
      />
      <input
        value={card.exp}
        onChange={(e) => setCard((c) => ({ ...c, exp: e.target.value }))}
        placeholder="MM/YY"
        autoComplete="cc-exp"
        required
      />
      <input
        value={card.cvc}
        onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value }))}
        placeholder="CVC"
        autoComplete="cc-csc"
        inputMode="numeric"
        required
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={paying || items.length === 0}>
        {paying ? 'Paying…' : 'Pay'}
      </button>
    </form>
  );
}
