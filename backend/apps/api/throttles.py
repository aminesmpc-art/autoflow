"""Request allowances beyond DRF's shared per-user one."""
from rest_framework.throttling import UserRateThrottle


class SubmissionRateThrottle(UserRateThrottle):
    """Flow's receipts and the clip results get their own, larger allowance
    (settings "submissions"). Under the shared 120/minute, busy runs had them
    refused (333 receipts on 2026-11-22) and those prompts went uncounted."""
    scope = "submissions"
