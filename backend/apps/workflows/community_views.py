"""Community template endpoints — the feed, posting, likes, reports, installs.

Split from views.py so the official bundle and the community set stay
independent all the way down. A 500 in here cannot stop the bundle being
served, which is the whole reason they are separate models.

Since 2026-10-25 this is a feed "like Facebook": a post is live the moment it
is made, and readers police it with reports (see community.py).
"""

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .community import (
    AUTO_HIDE_REPORTS,
    CommunityMember,
    CommunityReport,
    CommunityTemplate,
    TemplateLike,
    clean_display_name,
    validate_template_shape,
)

logger = logging.getLogger(__name__)

# A ceiling on what one account has ever posted, and on what it posts in a
# day. Posting is instant now, so the daily one is what stops a flood.
MAX_PER_AUTHOR = 200
POSTS_PER_DAY = 10


def _liked_ids(request, templates):
    """Which of these the caller has already liked.

    One query for the page rather than one per card, and an empty set for an
    anonymous caller — who can browse, and cannot like.
    """
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated or not templates:
        return set()
    return set(
        TemplateLike.objects.filter(
            user=user, template_id__in=[t.pk for t in templates]
        ).values_list("template_id", flat=True)
    )


def _viewer_id(request):
    user = getattr(request, "user", None)
    return user.pk if user is not None and user.is_authenticated else None


def _card(row, request, liked_ids) -> dict:
    return row.as_card(row.pk in liked_ids, mine=row.author_id == _viewer_id(request))


def _member(user) -> CommunityMember:
    member, _ = CommunityMember.objects.get_or_create(user=user)
    return member


class CommunityListView(APIView):
    """The feed: published posts, a page at a time.

    Open to anonymous callers for the same reason the bundle is: a gallery
    should render before a login form. Liking needs an account; looking does
    not.

    `offset` and `next` page it. An older client sends neither and gets the
    first `limit` rows, exactly as before.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        try:
            limit = max(1, min(int(request.query_params.get("limit", 60)), 100))
        except (TypeError, ValueError):
            limit = 60
        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (TypeError, ValueError):
            offset = 0

        qs = CommunityTemplate.objects.filter(status=CommunityTemplate.Status.PUBLISHED)
        sort = request.query_params.get("sort", "top")
        if sort == "new":
            qs = qs.order_by("-created_at", "-pk")
        elif sort == "installs":
            qs = qs.order_by("-install_count", "-created_at", "-pk")
        else:
            qs = qs.order_by("-like_count", "-created_at", "-pk")

        # One row past the page says whether there is another, without a COUNT.
        rows = list(qs[offset:offset + limit + 1])
        more = len(rows) > limit
        rows = rows[:limit]
        liked = _liked_ids(request, rows)
        return Response(
            {
                "templates": [_card(t, request, liked) for t in rows],
                "next": offset + limit if more else None,
            },
            status=status.HTTP_200_OK,
        )


class CommunityDetailView(APIView):
    """One template, with its payload — and the install that implies.

    Counted here rather than on the list, because opening a template is the
    action worth counting. F() so two people opening it at once do not read
    the same number and write it back.

    DELETE removes a post: its author's own, or any for staff.
    """

    def get_permissions(self):
        return [IsAuthenticated()] if self.request.method == "DELETE" else [AllowAny()]

    def get(self, request, pk):
        try:
            row = CommunityTemplate.objects.get(
                pk=pk, status=CommunityTemplate.Status.PUBLISHED
            )
        except CommunityTemplate.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        CommunityTemplate.objects.filter(pk=pk).update(install_count=F("install_count") + 1)
        card = _card(row, request, _liked_ids(request, [row]))
        card["payload"] = row.payload
        return Response(card, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        row = CommunityTemplate.objects.filter(pk=pk).first()
        if row is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if row.author_id != request.user.pk and not request.user.is_staff:
            return Response({"detail": "Only the person who posted this can delete it."},
                            status=status.HTTP_403_FORBIDDEN)
        row.delete()
        logger.info("Community template %s deleted by %s", pk, request.user.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CommunitySubmitView(APIView):
    """Post a workflow. Live at once — readers report what does not belong."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        if not user.is_active:
            return Response({"detail": "Verify your email address before posting."},
                            status=status.HTTP_403_FORBIDDEN)
        member = _member(user)
        if not member.can_post:
            return Response({"detail": "Posting is turned off for this account."},
                            status=status.HTTP_403_FORBIDDEN)

        payload = request.data.get("template")
        problem = validate_template_shape(payload)
        if problem:
            return Response({"detail": problem}, status=status.HTTP_400_BAD_REQUEST)

        # The name every post shows. Sent with the first post and kept; an
        # older client that sends only the email-derived author_name is asked
        # for one rather than printing part of an address in a public feed.
        if request.data.get("display_name") is not None:
            name, problem = clean_display_name(request.data.get("display_name"))
            if problem:
                return Response({"detail": problem, "code": "display_name"},
                                status=status.HTTP_400_BAD_REQUEST)
            if name != member.display_name:
                member.display_name = name
                member.save(update_fields=["display_name", "updated_at"])
                CommunityTemplate.objects.filter(author=user).update(author_name=name)
        if not member.display_name:
            return Response({"detail": "Choose a display name before posting.",
                             "code": "display_name_required"},
                            status=status.HTTP_400_BAD_REQUEST)

        mine = CommunityTemplate.objects.filter(author=user)
        if mine.count() >= MAX_PER_AUTHOR:
            return Response({"detail": f"You have already posted {MAX_PER_AUTHOR} workflows."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        if mine.filter(created_at__gte=timezone.now() - timedelta(days=1)).count() >= POSTS_PER_DAY:
            return Response({"detail": f"You can post {POSTS_PER_DAY} workflows a day. Try again tomorrow."},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)

        title = " ".join(str(request.data.get("name") or payload.get("name") or "").split())[:120]
        if len(title) < 2:
            return Response({"detail": "Give your post a title."}, status=status.HTTP_400_BAD_REQUEST)
        row = CommunityTemplate.objects.create(
            author=user,
            author_name=member.display_name,
            name=title,
            description=str(request.data.get("description") or payload.get("description") or "").strip()[:1000],
            category=str(payload.get("category") or "Community")[:60],
            thumbnail=str(payload.get("thumbnail") or "\U0001f9e9")[:16],
            payload=payload,
            status=CommunityTemplate.Status.PUBLISHED,
        )
        logger.info("Community template %s posted by %s", row.pk, user.pk)
        return Response(
            {"id": row.pk, "status": row.status, "card": row.as_card(False, mine=True),
             "detail": "Posted. It is in the feed now."},
            status=status.HTTP_201_CREATED,
        )


class CommunityLikeView(APIView):
    """Toggle a like.

    The counter is derived from the join table rather than incremented beside
    it, so a double press cannot drift the number away from the rows that
    justify it.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            row = CommunityTemplate.objects.get(
                pk=pk, status=CommunityTemplate.Status.PUBLISHED
            )
        except CommunityTemplate.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            try:
                # A SAVEPOINT, not just a try. On Postgres an IntegrityError
                # poisons the enclosing transaction: every later query in the
                # block raises TransactionManagementError, so the delete below
                # — the whole unlike path — died with it. The inner atomic()
                # rolls back only the failed insert and leaves the outer
                # transaction usable. SQLite tolerates the naive version, which
                # is exactly why this reached production before being found.
                with transaction.atomic():
                    TemplateLike.objects.create(template=row, user=request.user)
                liked = True
            except IntegrityError:
                TemplateLike.objects.filter(template=row, user=request.user).delete()
                liked = False
            count = TemplateLike.objects.filter(template=row).count()
            CommunityTemplate.objects.filter(pk=pk).update(like_count=count)

        return Response({"liked": liked, "likes": count}, status=status.HTTP_200_OK)


class CommunityReportView(APIView):
    """Report a post. Enough people doing so takes it down until an admin looks.

    The count is the open (not dismissed) reports, read from the table after
    the insert — never a number incremented beside it — and the hide is a
    conditional UPDATE, so two reports landing together cannot both decide.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        row = CommunityTemplate.objects.filter(
            pk=pk, status__in=[CommunityTemplate.Status.PUBLISHED, CommunityTemplate.Status.HIDDEN]
        ).first()
        if row is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if row.author_id == request.user.pk:
            return Response({"detail": "You cannot report your own post."},
                            status=status.HTTP_400_BAD_REQUEST)

        reason = str(request.data.get("reason") or CommunityReport.Reason.OTHER)
        if reason not in CommunityReport.Reason.values:
            return Response({"detail": "Choose a reason."}, status=status.HTTP_400_BAD_REQUEST)
        note = str(request.data.get("note") or "").strip()[:300]

        already = False
        with transaction.atomic():
            try:
                # A savepoint for the same Postgres reason as the like above.
                with transaction.atomic():
                    CommunityReport.objects.create(
                        template=row, reporter=request.user, reason=reason, note=note
                    )
            except IntegrityError:
                already = True
            open_reports = CommunityReport.objects.filter(template=row, dismissed=False).count()
            CommunityTemplate.objects.filter(pk=pk).update(report_count=open_reports)
            if open_reports >= AUTO_HIDE_REPORTS:
                hidden = CommunityTemplate.objects.filter(
                    pk=pk, status=CommunityTemplate.Status.PUBLISHED
                ).update(status=CommunityTemplate.Status.HIDDEN)
                if hidden:
                    logger.warning("Community template %s hidden after %s reports", pk, open_reports)

        return Response(
            {"reported": True, "already": already,
             "detail": "Thanks — you already reported this." if already else "Thanks. We will take a look."},
            status=status.HTTP_200_OK,
        )


class CommunityMeView(APIView):
    """The caller as the feed knows them: display name and whether they may post."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = CommunityMember.objects.filter(user=request.user).first()
        return Response({
            "displayName": member.display_name if member else "",
            "canPost": member.can_post if member else True,
            "posts": CommunityTemplate.objects.filter(author=request.user).count(),
        }, status=status.HTTP_200_OK)

    def post(self, request):
        name, problem = clean_display_name(request.data.get("display_name"))
        if problem:
            return Response({"detail": problem, "code": "display_name"}, status=status.HTTP_400_BAD_REQUEST)
        member = _member(request.user)
        member.display_name = name
        member.save(update_fields=["display_name", "updated_at"])
        CommunityTemplate.objects.filter(author=request.user).update(author_name=name)
        return Response({"displayName": name, "canPost": member.can_post}, status=status.HTTP_200_OK)
