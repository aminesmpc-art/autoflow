"""Whop v1 / Standard Webhooks verification over untouched request bytes."""

import base64
import binascii
import hmac
import time


def verify_signature(raw: bytes, headers, secret: str) -> bool:
    event_id = headers.get("webhook-id", "")
    timestamp = headers.get("webhook-timestamp", "")
    signatures = headers.get("webhook-signature", "")
    if not secret or not event_id or len(event_id) > 256 or not signatures:
        return False
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
        # Current Whop ws_ secrets are literal keys. Only explicit legacy
        # Standard Webhooks whsec_ secrets are base64 encoded.
        key = (
            base64.b64decode(secret[6:], validate=True)
            if secret.startswith("whsec_")
            else secret.encode("utf-8")
        )
    except (ValueError, TypeError, binascii.Error):
        return False
    message = f"{event_id}.{timestamp}.".encode() + raw
    expected = base64.b64encode(hmac.digest(key, message, "sha256")).decode("ascii")
    return any(
        part.startswith("v1,")
        and hmac.compare_digest(expected.encode(), part[3:].encode())
        for part in signatures.split()
    )
