"""Each clip's result, as the extension sees it happen (2026-11-15).

The owner asked that the backend hear of every clip's done or failed while
the queue runs, not only when it ends, and that what is sent be "only for
counting and pro and free limits". So an event carries the queue, the prompt
number, the result, Flow's media id, the retry number, text or full (what
the Free and Pro limits count), the run mode and the time, and nothing else:
no prompt words, no failure reason.

It moves no counter. Charging stays where it is (consume_queue_run at the
start, PromptSubmittedView per accepted prompt); these rows are the per-clip
record the counts and limits can be checked against. Rows go into the same
UsageEvent timeline the admin dashboard already draws, with
metadata.source = "queue" so the Studio run counts (queue_started with
source "studio") never see them.

Idempotent on metadata.event_id ("<browser id>:<seq>"): the extension
re-sends a batch whose answer it never got, and a re-sent event must not be
a second row in a count.
"""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.usage.models import UsageEvent

logger = logging.getLogger(__name__)

MAX_BATCH = 50

# The extension's moment → the timeline's event type. Results only (the
# owner's choice): typing, sent and generating are not sent, and "sent" is
# already PromptSubmittedView's row, with the media id.
KIND_TO_TYPE = {
    "done": UsageEvent.EventType.PROMPT_DONE,
    "failed": UsageEvent.EventType.PROMPT_FAILED,
    "retrying": UsageEvent.EventType.PROMPT_RETRIED,
    "queue-started": UsageEvent.EventType.QUEUE_STARTED,
    "queue-finished": UsageEvent.EventType.QUEUE_FINISHED,
    "queue-stopped": UsageEvent.EventType.RUN_ABORTED,
    # Not about a queue (2026-11-22): what the dashboard needs to show who
    # uses characters and AI agents. queue_id carries "characters" / "agent".
    "character-made": UsageEvent.EventType.CHARACTER_MADE,
    "character-deleted": UsageEvent.EventType.CHARACTER_DELETED,
    "agent-connected": UsageEvent.EventType.AGENT_CONNECTED,
}
QUEUE_KINDS = {"queue-started", "queue-finished", "queue-stopped"}
SIDE_KINDS = {"character-made", "character-deleted", "agent-connected"}


def _int(value, low=0, high=100_000):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if low <= n <= high else None


def _text(value, n):
    return str(value or "").strip()[:n]


class QueueEventsView(APIView):
    """POST {"events": [{event_id, kind, queue_id, prompt, media_id?, retry?,
    tally?, at?, mode?, prompt_type?}, ...]} — at most 50. Answers how many were written
    and how many were already there; an event it cannot read is skipped, not
    a reason to refuse the rest."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        events = request.data.get("events") if isinstance(request.data, dict) else None
        if not isinstance(events, list):
            return Response({"detail": "events must be a list."}, status=status.HTTP_400_BAD_REQUEST)
        if len(events) > MAX_BATCH:
            return Response({"detail": f"At most {MAX_BATCH} events at a time."}, status=status.HTTP_400_BAD_REQUEST)

        created = duplicate = skipped = 0
        for raw in events:
            if not isinstance(raw, dict):
                skipped += 1
                continue
            kind = _text(raw.get("kind"), 32)
            event_type = KIND_TO_TYPE.get(kind)
            event_id = _text(raw.get("event_id"), 80)
            queue_id = _text(raw.get("queue_id"), 128)
            if not event_type or not event_id or not queue_id:
                skipped += 1
                continue
            if UsageEvent.objects.filter(user=request.user, metadata__event_id=event_id).exists():
                duplicate += 1
                continue

            number = _int(raw.get("prompt"), 1)
            metadata = {"source": "queue", "event_id": event_id, "kind": kind}
            mode = _text(raw.get("mode"), 16)
            if mode:
                metadata["mode"] = mode
            # What the limits count: a prompt with images or frames is "full".
            prompt_type = _text(raw.get("prompt_type"), 8)
            if prompt_type in ("text", "full"):
                metadata["prompt_type"] = prompt_type
            at = _text(raw.get("at"), 40)
            if at:
                metadata["at"] = at  # when it happened, in the browser
            retry = _int(raw.get("retry"), 0, 10)
            if retry is not None:
                metadata["retry"] = retry
            media_id = _text(raw.get("media_id"), 128)
            if media_id:
                # Not the media_id column: that one is unique and belongs to
                # the prompt_submitted row the same clip already has.
                metadata["media_id"] = media_id
            if kind in SIDE_KINDS:
                # Which agent (its MCP client name, e.g. "claude-code"), and
                # how many characters the account holds after the change.
                agent = _text(raw.get("agent"), 40)
                if agent:
                    metadata["agent"] = agent
                count = _int(raw.get("count"), 0, 10_000)
                if count is not None:
                    metadata["count"] = count
            tally = raw.get("tally")
            if kind in QUEUE_KINDS and isinstance(tally, dict):
                metadata["tally"] = {k: n for k in ("total", "done", "failed", "waiting")
                                     if (n := _int(tally.get(k))) is not None}

            UsageEvent.objects.create(
                user=request.user,
                event_type=event_type,
                prompt_count=(metadata.get("tally", {}).get("total", 0) if kind in QUEUE_KINDS else 1),
                queue_id=queue_id,
                prompt_index=(number - 1) if number else None,
                metadata=metadata,
            )
            created += 1

        return Response({"created": created, "duplicate": duplicate, "skipped": skipped}, status=status.HTTP_200_OK)
