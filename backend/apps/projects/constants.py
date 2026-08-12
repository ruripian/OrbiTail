"""프로젝트 기본 상태(State) 정의 — 일반 프로젝트와 Personal 프로젝트 공용 단일 소스.

생성 경로가 두 곳(ProjectSerializer.create / get_or_create_personal_project)으로 나뉘어
있어 색상 팔레트가 서로 어긋났었다. 특히 Todo·In Progress 색이 반대로 들어가
"내 이슈"와 일반 프로젝트의 같은 상태가 다른 색으로 보였다. 팔레트를 여기 한 곳에 둔다.

sequence 와 default(기본 상태) 는 프로젝트 종류마다 정책이 달라 호출부가 결정한다.
  - 일반 프로젝트: Backlog 가 기본 상태 (새 이슈는 백로그에서 출발)
  - Personal 프로젝트: Todo 가 기본 상태 (단발성 이슈는 바로 할 일로 잡히는 게 자연스러움)
"""

DEFAULT_STATES = [
    {"name": "Backlog",     "group": "backlog",   "color": "#A3A3A3"},
    {"name": "Todo",        "group": "unstarted", "color": "#F0AD4E"},
    {"name": "In Progress", "group": "started",   "color": "#5E6AD2"},
    {"name": "Done",        "group": "completed", "color": "#26B55E"},
    {"name": "Cancelled",   "group": "cancelled", "color": "#D94F4F"},
]
