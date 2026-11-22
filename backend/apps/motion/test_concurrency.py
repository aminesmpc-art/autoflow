"""Run against an isolated PostgreSQL test DB before launch; SQLite cannot prove row locks."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import close_old_connections
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature

from apps.plans.models import Profile
from apps.users.models import CustomUser

from .models import MotionRun
from .services import reserve_run
from .tests import CONFIG, FINGERPRINT


@override_settings(**CONFIG)
@skipUnlessDBFeature("has_select_for_update")
class ConcurrentMotionUsageTests(TransactionTestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user("buyer@example.com", is_active=True)
        # Free, because only Free has a limit for simultaneous jobs to race past.
        Profile.objects.create(user=self.user, plan_type="free")

    def requests(self, jobs):
        barrier = Barrier(len(jobs))

        def worker(job):
            close_old_connections()
            try:
                user = CustomUser.objects.get(pk=self.user.pk)
                barrier.wait(timeout=10)
                return reserve_run(user, job, FINGERPRINT)[1]
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            return list(pool.map(worker, jobs))

    def test_simultaneous_different_jobs_stop_at_three(self):
        statuses = self.requests([uuid.uuid4() for _ in range(6)])
        self.assertEqual(statuses.count(201), 3)
        self.assertEqual(statuses.count(429), 3)
        self.assertEqual(MotionRun.objects.count(), 3)

    def test_simultaneous_retries_charge_once(self):
        statuses = self.requests([uuid.uuid4()] * 6)
        self.assertEqual(statuses.count(201), 1)
        self.assertEqual(statuses.count(200), 5)
        self.assertEqual(MotionRun.objects.count(), 1)
