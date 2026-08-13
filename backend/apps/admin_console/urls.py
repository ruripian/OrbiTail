from django.urls import path

from .views import (
    AdminOverviewView,
    DocumentAttachmentListView,
    IssueAttachmentListView,
)

urlpatterns = [
    path("overview/", AdminOverviewView.as_view(), name="admin-overview"),
    path(
        "content/document-attachments/",
        DocumentAttachmentListView.as_view(),
        name="admin-document-attachments",
    ),
    path(
        "content/issue-attachments/",
        IssueAttachmentListView.as_view(),
        name="admin-issue-attachments",
    ),
]
