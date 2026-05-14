"""Marketing email sequence — core business logic.

Handles email sending via Resend, subscriber management,
and follow-up scheduling via management command.
"""
import logging
from datetime import datetime

from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

from .models import EmailSequenceSubscriber

logger = logging.getLogger(__name__)

# ── Email Config ──
# Maps email number (1, 2, 3) to template + subject
EMAIL_SEQUENCE = {
    1: {
        "template": "marketing/email_1_welcome.html",
        "subject": "🎉 Welcome! Here's Your Exclusive Offer",
    },
    2: {
        "template": "marketing/email_2_reminder.html",
        "subject": "⏰ Don't Miss Out — Your Offer Expires Soon",
    },
    3: {
        "template": "marketing/email_3_final.html",
        "subject": "🔥 Last Chance — Offer Ends Today",
    },
}

# Days after opt-in to send each follow-up
FOLLOW_UP_SCHEDULE = {
    2: 3,   # Email 2 → 3 days after opt-in
    3: 7,   # Email 3 → 7 days after opt-in
}


def get_marketing_context(subscriber: EmailSequenceSubscriber, email_number: int) -> dict:
    """Build template context for a marketing email."""
    product_name = getattr(settings, "MARKETING_PRODUCT_NAME", "AutoFlow Pro")
    base_url = getattr(settings, "MARKETING_CTA_URL", "https://auto-flow.studio/upgrade")

    # CTA URL includes the tracking token so we can attribute clicks
    api_base = getattr(
        settings, "VERIFY_EMAIL_BASE_URL", "https://api.auto-flow.studio/api/auth/verify-email"
    )
    # Build tracking URL from API domain
    api_domain = api_base.rsplit("/api/", 1)[0] if "/api/" in api_base else "https://api.auto-flow.studio"
    track_url = f"{api_domain}/api/marketing/track/{subscriber.tracking_token}"

    return {
        "product_name": product_name,
        "cta_url": track_url,
        "direct_url": base_url,
        "subscriber_email": subscriber.email,
        "email_number": email_number,
        "year": datetime.now().year,
    }


def send_marketing_email(subscriber: EmailSequenceSubscriber, email_number: int) -> bool:
    """Send a single marketing email via Resend.

    Returns True on success, False on failure.
    Think of this as a postal worker — it takes the letter (template),
    addresses it, and hands it to Resend (the post office) for delivery.
    """
    if email_number not in EMAIL_SEQUENCE:
        logger.error("Invalid email number: %d", email_number)
        return False

    if subscriber.action_taken:
        logger.info("Skipping email %d for %s — action already taken", email_number, subscriber.email)
        return False

    try:
        import resend

        api_key = getattr(settings, "RESEND_API_KEY", "")
        if not api_key:
            logger.warning("RESEND_API_KEY not set — skipping marketing email for %s", subscriber.email)
            return False

        resend.api_key = api_key

        config = EMAIL_SEQUENCE[email_number]
        context = get_marketing_context(subscriber, email_number)

        # Render HTML template
        try:
            html_content = render_to_string(config["template"], context)
        except Exception as e:
            logger.error("Failed to render template %s: %s", config["template"], e)
            return False

        # Plain-text fallback
        text_content = (
            f"Hi there!\n\n"
            f"Check out {context['product_name']} — the ultimate automation tool.\n\n"
            f"Get started: {context['direct_url']}\n\n"
            f"— The AutoFlow Team"
        )

        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "AutoFlow <noreply@auto-flow.studio>")

        params = {
            "from": from_email,
            "to": [subscriber.email],
            "subject": config["subject"],
            "html": html_content,
            "text": text_content,
        }

        resend.Emails.send(params)

        # Update subscriber record
        subscriber.emails_sent = email_number
        subscriber.last_email_at = timezone.now()
        if email_number >= 3:
            subscriber.sequence_completed = True
        subscriber.save(update_fields=["emails_sent", "last_email_at", "sequence_completed", "updated_at"])

        logger.info("Marketing email %d sent to %s", email_number, subscriber.email)
        return True

    except Exception as exc:
        logger.error("Failed to send marketing email %d to %s: %s", email_number, subscriber.email, exc)
        return False


def subscribe_to_sequence(email: str, source: str = "extension") -> tuple:
    """Subscribe an email to the marketing sequence and send Email 1.

    Returns (subscriber, created, message).
    """
    import threading

    email = email.strip().lower()

    subscriber, created = EmailSequenceSubscriber.objects.get_or_create(
        email=email,
        defaults={"source": source},
    )

    if not created:
        if subscriber.action_taken:
            return subscriber, False, "Already subscribed and took action."
        if subscriber.emails_sent >= 1:
            return subscriber, False, "Already subscribed to this sequence."

    # Send Email 1 immediately in a background thread
    threading.Thread(
        target=send_marketing_email,
        args=(subscriber, 1),
        daemon=True,
    ).start()

    return subscriber, created, "Subscribed! Check your inbox."


def process_pending_reminders() -> dict:
    """Scan for subscribers needing follow-up emails and send them.

    Designed to be called by the management command on a cron schedule.
    Returns a summary dict with counts.
    """
    now = timezone.now()
    stats = {"scanned": 0, "email_2_sent": 0, "email_3_sent": 0, "skipped": 0, "errors": 0}

    # Get all active subscribers who haven't completed the sequence
    pending = EmailSequenceSubscriber.objects.filter(
        action_taken=False,
        sequence_completed=False,
        emails_sent__gte=1,  # At least Email 1 was sent
        emails_sent__lt=3,   # Haven't sent all 3 yet
    )

    for subscriber in pending:
        stats["scanned"] += 1
        days_since_optin = (now - subscriber.created_at).days

        # Determine which email to send next
        next_email = subscriber.emails_sent + 1
        required_days = FOLLOW_UP_SCHEDULE.get(next_email)

        if required_days is None:
            stats["skipped"] += 1
            continue

        if days_since_optin < required_days:
            stats["skipped"] += 1
            continue

        # Re-check action_taken (might have changed since query)
        subscriber.refresh_from_db()
        if subscriber.action_taken:
            stats["skipped"] += 1
            continue

        success = send_marketing_email(subscriber, next_email)
        if success:
            stats[f"email_{next_email}_sent"] += 1
        else:
            stats["errors"] += 1

    return stats


def mark_action_taken(tracking_token: str) -> tuple:
    """Mark a subscriber as having taken action (clicked CTA).

    Returns (subscriber, success, redirect_url).
    """
    cta_url = getattr(settings, "MARKETING_CTA_URL", "https://auto-flow.studio/upgrade")

    try:
        import uuid as uuid_mod
        token_uuid = uuid_mod.UUID(str(tracking_token))
        subscriber = EmailSequenceSubscriber.objects.get(tracking_token=token_uuid)
    except (ValueError, EmailSequenceSubscriber.DoesNotExist):
        logger.warning("Invalid tracking token: %s", tracking_token)
        return None, False, cta_url

    if not subscriber.action_taken:
        subscriber.action_taken = True
        subscriber.sequence_completed = True
        subscriber.save(update_fields=["action_taken", "sequence_completed", "updated_at"])
        logger.info("Action tracked for %s via token %s", subscriber.email, tracking_token)

    return subscriber, True, cta_url
