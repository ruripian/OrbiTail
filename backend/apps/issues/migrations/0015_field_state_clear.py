from django.db import migrations


def clear_field_states(apps, schema_editor):
    Issue = apps.get_model("issues", "Issue")
    Issue.objects.filter(is_field=True).update(state=None)


class Migration(migrations.Migration):

    dependencies = [
        ("issues", "0014_issueattachment_deleted_at"),
    ]

    operations = [
        migrations.RunPython(clear_field_states, migrations.RunPython.noop),
    ]
