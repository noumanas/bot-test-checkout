import { useEffect, useState } from 'react';

interface CartItem {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
}

interface Props {
  items: CartItem[];
  promoMessage: string; // from the ?promo= query string
  onPay: (card: { number: string; exp: string; cvc: string }) => Promise<void>;
}

export function CheckoutForm({ items, promoMessage, onPay }: Props) {
  const [card, setCard] = useState({ number: '', exp: '', cvc: '' });
  const [total, setTotal] = useState(0);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    setTotal(items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0));
  }, []);

  useEffect(() => {
    localStorage.setItem('checkout-card', JSON.stringify(card));
  }, [card]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPaying(true);
    await onPay(card);
    setPaying(false);
  }

  return (
    <form onSubmit={submit}>
      <div className="promo" dangerouslySetInnerHTML={{ __html: promoMessage }} />
      <ul>
        {items.map((item) => (
          <li>
            {item.name} × {item.quantity}
          </li>
        ))}
      </ul>
      <p>Total: ${(total / 100).toFixed(2)}</p>
      <input value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} placeholder="Card number" />
      <input value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} placeholder="MM/YY" />
      <input value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} placeholder="CVC" />
      <button type="submit">{paying ? 'Paying…' : 'Pay'}</button>
    </form>
  );
}
