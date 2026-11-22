from django.contrib import admin
from django.urls import include, path
from apps.studio_admin_view import StudioUsersDashboardView
from apps.overview import OverviewUserView, OverviewView

urlpatterns = [
    path("admin/studio-users/", StudioUsersDashboardView.as_view(), name="admin-studio-users"),
    # Everyone and what each one uses (apps/overview.py, 2026-11-22).
    path("admin/overview/", OverviewView.as_view(), name="admin-overview"),
    path("admin/overview/user/<uuid:user_id>/", OverviewUserView.as_view(), name="admin-overview-user"),
    path("admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    path("api/marketing/", include("apps.marketing.urls")),
]
