from django.contrib import admin
from .models import PersonalEvent


@admin.register(PersonalEvent)
class PersonalEventAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "date", "event_type", "created_at")
    list_filter = ("event_type", "date")
    search_fields = ("title", "description", "user__display_name", "user__email")
    raw_id_fields = ("user",)
