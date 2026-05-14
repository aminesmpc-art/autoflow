"""Marketing URL routing."""
from django.urls import path

from . import views

urlpatterns = [
    path("subscribe", views.SubscribeView.as_view(), name="marketing-subscribe"),
    path("track/<uuid:token>", views.TrackClickView.as_view(), name="marketing-track"),
]
