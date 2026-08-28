from django.contrib import admin
from django.urls import include, path
from apps.studio_admin_view import StudioUsersDashboardView

urlpatterns = [
    path("admin/studio-users/", StudioUsersDashboardView.as_view(), name="admin-studio-users"),
    path("admin/", admin.site.urls),
    path("api/", include("apps.api.urls")),
    path("api/marketing/", include("apps.marketing.urls")),
]
