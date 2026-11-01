import csv
import json
import logging
import os
import re
import subprocess
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

INVOICE_DIR = os.path.realpath("/var/app/invoices")
TEMPLATE_DIR = os.path.realpath("/var/app/invoice-templates")
TAX_RATE = Decimal("0.0825")
CARD_FEE = Decimal("0.30")
CENT = Decimal("0.01")
INVOICE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

log = logging.getLogger(__name__)


@dataclass
class Line:
    description: str
    unit_price: Decimal
    quantity: int


def invoice_total(lines, extra_fees=None):
    """Total including tax and the card processing fee, rounded half-up to cents."""
    subtotal = sum((Decimal(line.unit_price) * line.quantity for line in lines), Decimal("0"))
    fees = [Decimal(fee) for fee in (extra_fees or [])] + [CARD_FEE]
    subtotal += sum(fees, Decimal("0"))
    return (subtotal * (1 + TAX_RATE)).quantize(CENT, rounding=ROUND_HALF_UP)


def _inside(base, path):
    real = os.path.realpath(path)
    return os.path.commonpath([base, real]) == base


def invoice_path(invoice_id):
    """Path of an invoice's PDF. Only plain ids are accepted, so it can't point outside INVOICE_DIR."""
    if not INVOICE_ID.fullmatch(str(invoice_id)):
        raise ValueError(f"Invalid invoice id: {invoice_id!r}")
    path = os.path.join(INVOICE_DIR, f"{invoice_id}.pdf")
    if not _inside(INVOICE_DIR, path):
        raise ValueError(f"Invalid invoice id: {invoice_id!r}")
    return path


def read_invoice_pdf(invoice_id):
    with open(invoice_path(invoice_id), "rb") as f:
        return f.read()


def render_pdf(invoice_id, html_path):
    if not _inside(TEMPLATE_DIR, html_path) or not os.path.isfile(html_path):
        raise ValueError("HTML must be a file in the invoice templates folder")
    out = invoice_path(invoice_id)
    # Argument list, no shell: paths are never interpreted as commands or options.
    subprocess.run(["wkhtmltopdf", "--disable-local-file-access", "--", os.path.realpath(html_path), out], check=True)
    return out


def load_draft(raw_bytes):
    """Drafts are stored as JSON; never unpickle data from outside the process."""
    draft = json.loads(raw_bytes.decode("utf-8"))
    if not isinstance(draft, dict):
        raise ValueError("Draft must be a JSON object")
    return draft


def send_invoice(mailer, customer_email, invoice_id):
    """Emails the invoice PDF. Returns False (and logs why) if it couldn't be sent."""
    try:
        pdf = read_invoice_pdf(invoice_id)
    except (OSError, ValueError):
        log.exception("Could not read invoice %s", invoice_id)
        return False
    try:
        mailer.send(to=customer_email, subject="Your invoice", attachment=pdf)
    except Exception:
        log.exception("Could not email invoice %s", invoice_id)
        return False
    return True


def list_invoices(conn, customer_id, status="open"):
    """Invoices for one customer, newest first."""
    cur = conn.execute(
        "SELECT id, total, status FROM invoices WHERE customer_id = ? AND status = ? ORDER BY created_at DESC",
        (customer_id, status),
    )
    return cur.fetchall()


FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value):
    """Text a spreadsheet would run as a formula (e.g. a customer named "=HYPERLINK(...)") is quoted as text."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def export_csv(rows, out_file):
    """Writes invoice rows (id, customer name, total) for finance to open in Excel."""
    writer = csv.writer(out_file)
    writer.writerow(["id", "customer", "total"])
    for row in rows:
        writer.writerow([_csv_safe(row["id"]), _csv_safe(row["customer"]), row["total"]])
