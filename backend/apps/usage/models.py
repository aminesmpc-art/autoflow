"""Usage models — daily/monthly consumption tracking and event logging."""
import uuid

from django.conf import settings
from django.db import models


class DailyUsage(models.Model):
    """Tracks per-day prompt consumption for a user."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="daily_usages",
    )
    date = models.DateField(db_index=True)
    free_prompts_used = models.PositiveIntegerField(default=0)
    reward_prompts_used = models.PositiveIntegerField(default=0)
    total_prompts_used = models.PositiveIntegerField(default=0)
    text_prompts_used = models.PositiveIntegerField(default=0, help_text="Text-to-video prompts (no images)")
    full_prompts_used = models.PositiveIntegerField(default=0, help_text="Full-feature prompts (with images/frames)")
    extend_prompts_used = models.PositiveIntegerField(default=0, help_text="Extended video prompts")
    downloads_used = models.PositiveIntegerField(default=0, help_text="Media downloads today")
    clipping_jobs_used = models.PositiveIntegerField(default=0, help_text="Clipping jobs accepted today")
    # Queue run counters (per mode)
    lite_runs_today = models.PositiveIntegerField(default=0, help_text="Lite queue runs today")
    flow_runs_today = models.PositiveIntegerField(default=0, help_text="Flow queue runs today")
    full_runs_today = models.PositiveIntegerField(default=0, help_text="Full queue runs today")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "date")
        verbose_name = "daily usage"
        verbose_name_plural = "daily usages"
        ordering = ["-date"]

    def __str__(self):
        return f"{self.user.email} — {self.date} ({self.total_prompts_used} used)"


class MonthlyUsage(models.Model):
    """Tracks per-month queue run consumption (Full mode)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="monthly_usages",
    )
    year = models.PositiveIntegerField(db_index=True)
    month = models.PositiveIntegerField(db_index=True, help_text="1-12")
    full_runs_used = models.PositiveIntegerField(default=0, help_text="Full queue runs this month")
    studio_runs_used = models.PositiveIntegerField(default=0, help_text="Studio workflow runs this month")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "year", "month")
        verbose_name = "monthly usage"
        verbose_name_plural = "monthly usages"
        ordering = ["-year", "-month"]

    def __str__(self):
        return f"{self.user.email} — {self.year}/{self.month:02d} ({self.full_runs_used} full runs)"


class PromptReservation(models.Model):
    """Prompts a queue has CLAIMED but not yet spent.

    ── Why a hold and not a charge ──────────────────────────────────────

    Charging at queue start is what makes the dashboard's number mean
    "prompts queued": every failure between starting and submitting is
    billed and invisible. Charging at submission instead fixes that, but on
    its own it removes the gate — a free user with five prompts left could
    start a hundred-prompt queue and overshoot before the meter caught up,
    because nothing would have been spent when the limit was checked.

    So the run still claims N up front. It just holds them instead of
    spending them: each submission commits one, the extension releases the
    remainder when the run ends, and anything never released expires.
    Limit checks count used + held, so the gate is exactly as strict as it
    is today while the billing becomes truthful.

    ── Why a table rather than a counter on DailyUsage ──────────────────

    A single held integer cannot be released per run, cannot expire, and
    drifts permanently the first time a worker dies mid-queue — and a
    counter that only ever grows is the failure this whole change exists
    to remove. Rows can be reconciled; a number cannot.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="prompt_reservations",
    )
    # One per queue run. Unique so a retried start cannot double-hold.
    queue_id = models.CharField(max_length=128, unique=True)
    mode = models.CharField(max_length=32, blank=True, default="")

    held = models.PositiveIntegerField(
        default=0, help_text="Still claimed and not yet spent.")
    committed = models.PositiveIntegerField(
        default=0, help_text="Spent — one per prompt Flow actually received.")
    # Kept apart so a mixed queue commits into the right bucket later.
    held_text = models.PositiveIntegerField(default=0)
    held_full = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "prompt reservation"
        verbose_name_plural = "prompt reservations"
        indexes = [
            # "What is this user still holding?" — asked on every limit check,
            # so it must not be a scan.
            models.Index(fields=["user", "released_at", "expires_at"],
                         name="reservation_user_open"),
        ]

    def __str__(self):
        return f"{self.user.email} — {self.queue_id} ({self.held} held)"

    @property
    def is_open(self) -> bool:
        return self.released_at is None and self.held > 0


class UsageEvent(models.Model):
    """Individual usage/telemetry events from the extension or backend."""

    class EventType(models.TextChoices):
        CONSUME_PROMPT = "consume_prompt", "Consume Prompt"
        QUEUE_STARTED = "queue_started", "Queue Started"
        QUEUE_FINISHED = "queue_finished", "Queue Finished"
        PROMPT_FAILED = "prompt_failed", "Prompt Failed"
        DOWNLOAD_COMPLETED = "download_completed", "Download Completed"
        RUN_ABORTED = "run_aborted", "Run Aborted"
        REWARD_GRANTED = "reward_granted", "Reward Granted"
        QUEUE_RUN_LITE = "queue_run_lite", "Queue Run (Lite)"
        QUEUE_RUN_FLOW = "queue_run_flow", "Queue Run (Flow)"
        QUEUE_RUN_FULL = "queue_run_full", "Queue Run (Full)"
        CLIPPING_JOB_STARTED = "clipping_job_started", "Clipping Job Started"
        # Server-observed proof that one prompt reached Flow AND Flow accepted
        # it: the interceptor read a media id out of Flow's own response. This
        # is the event the dashboard's billable number should come from.
        PROMPT_SUBMITTED = "prompt_submitted", "Prompt Submitted to Flow"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="usage_events",
    )
    event_type = models.CharField(max_length=50, choices=EventType.choices, db_index=True)
    prompt_count = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # ── Identity ─────────────────────────────────────────────────────────
    #
    # Real columns, not metadata keys. Everything about this event that
    # another request has to MATCH ON lives here, because matching is what
    # the old scheme got wrong: reconciliation found "the oldest pending
    # event of this type today", so two queues running on the same day
    # flipped each other's rows, and a prompt that changed type mid-run
    # matched nothing and created an N+1th event.
    #
    # media_id is unique and nullable on purpose. Unique is the whole
    # idempotency guarantee — a replayed message, a worker restart or a
    # double-send cannot charge twice, because the second insert loses to
    # the index rather than to application code that might not run.
    # Nullable because every event that already exists, and every event that
    # is not a submission, has no media id; Postgres permits any number of
    # NULLs in a unique index, which is exactly the shape wanted. (A blank
    # default would instead make every one of those rows collide.)
    media_id = models.CharField(
        max_length=128, null=True, blank=True, unique=True, default=None,
        help_text="Flow's own id for the generation this prompt produced.",
    )
    queue_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    prompt_index = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "usage event"
        verbose_name_plural = "usage events"
        indexes = [
            # The dashboard's question: what did this user send to Flow, in
            # this period? Answered off the index rather than a table scan
            # over every telemetry row the extension has ever emitted.
            models.Index(fields=["user", "event_type", "created_at"],
                         name="usageevent_user_type_at"),
            # And the per-run one, for "which prompts of this queue landed".
            models.Index(fields=["queue_id", "prompt_index"],
                         name="usageevent_queue_index"),
        ]

    def __str__(self):
        return f"{self.user.email} — {self.event_type} @ {self.created_at}"


class ClippingUsage(models.Model):
    """Immutable charge ledger used to make clipping retries idempotent."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="clipping_usages",
    )
    idempotency_key = models.CharField(max_length=128)
    date = models.DateField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("user", "idempotency_key"),
                name="unique_clipping_charge_per_user_job",
            ),
        ]
        indexes = [models.Index(fields=("user", "date"), name="clip_usage_user_date")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} — {self.idempotency_key} @ {self.date}"
