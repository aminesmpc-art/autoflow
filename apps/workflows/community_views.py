"""Community template endpoints — browse, submit, like, install.

Split from views.py so the official bundle and the community set stay
independent all the way down. A 500 in here cannot stop the bundle being
served, which is the whole reason they are separate models.
"""

import logging

from django.db import IntegrityError, transaction
from django.db.models import F
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .community import CommunityTemplate, TemplateLike, validate_template_shape

logger = logging.getLogger(__name__)

MAX_PER_AUTHOR = 30


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


class CommunityListView(APIView):
    """Published community templates, most liked first.

    Open to anonymous callers for the same reason the bundle is: a gallery
    should render before a login form. Liking needs an account; looking does
    not.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        try:
            limit = min(int(request.query_params.get("limit", 60)), 100)
        except (TypeError, ValueError):
            limit = 60

        qs = CommunityTemplate.objects.filter(status=CommunityTemplate.Status.PUBLISHED)
        sort = request.query_params.get("sort", "top")
        if sort == "new":
            qs = qs.order_by("-created_at")
        elif sort == "installs":
            qs = qs.order_by("-install_count", "-created_at")

        rows = list(qs[:limit])
        liked = _liked_ids(request, rows)
        return Response(
            {"templates": [t.as_card(t.pk in liked) for t in rows]},
            status=status.HTTP_200_OK,
        )


class CommunityDetailView(APIView):
    """One template, with its payload — and the install that implies.

    Counted here rather than on the list, because opening a template is the
    action worth counting. F() so two people opening it at once do not read
    the same number and write it back.
    """

    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            row = CommunityTemplate.objects.get(
                pk=pk, status=CommunityTemplate.Status.PUBLISHED
            )
        except CommunityTemplate.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        CommunityTemplate.objects.filter(pk=pk).update(install_count=F("install_count") + 1)
        liked = bool(_liked_ids(request, [row]))
        card = row.as_card(liked)
        card["payload"] = row.payload
        return Response(card, status=status.HTTP_200_OK)


class CommunitySubmitView(APIView):
    """Share a workflow. Lands as pending, never live."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = request.data.get("template")
        problem = validate_template_shape(payload)
        if problem:
            return Response({"detail": problem}, status=status.HTTP_400_BAD_REQUEST)

        mine = CommunityTemplate.objects.filter(author=request.user).count()
        if mine >= MAX_PER_AUTHOR:
            return Response(
                {"detail": f"You have already shared {mine} templates."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        name = str(request.data.get("name") or payload.get("name") or "Untitled")[:120]
        row = CommunityTemplate.objects.create(
            author=request.user,
            author_name=(request.data.get("author_name") or "")[:120],
            name=name,
            description=str(request.data.get("description") or payload.get("description") or "")[:300],
            category=str(payload.get("category") or "Community")[:60],
            thumbnail=str(payload.get("thumbnail") or "\U0001f9e9")[:16],
            payload=payload,
        )
        logger.info("Community template %s submitted by %s", row.pk, request.user.pk)
        return Response(
            {
                "id": row.pk,
                "status": row.status,
                "detail": "Shared. It appears in the gallery once a moderator approves it.",
            },
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
