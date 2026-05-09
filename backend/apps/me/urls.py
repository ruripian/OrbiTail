from django.urls import path
from .views import (
    PersonalEventListCreateView,
    PersonalEventDetailView,
    MeIssuesView,
    MeProjectEventsView,
    MeSummaryView,
    MeNodeGraphView,
)

urlpatterns = [
    path("issues/",          MeIssuesView.as_view(),               name="me-issues"),
    path("project-events/",  MeProjectEventsView.as_view(),        name="me-project-events"),
    path("personal-events/", PersonalEventListCreateView.as_view(), name="me-personal-events"),
    path("personal-events/<uuid:pk>/", PersonalEventDetailView.as_view(), name="me-personal-event-detail"),
    path("summary/",         MeSummaryView.as_view(),              name="me-summary"),
    path("graph/",           MeNodeGraphView.as_view(),            name="me-graph"),
]
